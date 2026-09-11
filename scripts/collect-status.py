#!/usr/bin/python3
"""Root-owned, read-only probes; publish only an explicit public status projection."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from email.message import EmailMessage
import fcntl
from html import escape
from http.server import BaseHTTPRequestHandler
import json
import math
import os
from pathlib import Path
import re
import smtplib
import ssl
import socketserver
import subprocess
import sys
from threading import Lock
import time
import urllib.error
import urllib.request

BASE = Path('/opt/sunrise-travelops-dev')
PUBLIC = BASE / 'status'
PRIVATE = BASE / 'status-state'
COMPOSE = ['docker', 'compose', '--env-file', 'server.env', '-f', 'compose.dev.yml']
WORKFLOWS = {
    'frontend': ('Prainn/sunrise-travelops-web', 'deploy-dev.yml'),
    'backend': ('Prainn/sunrise-travelops-backend', 'ci.yml'),
}
RELEASE = re.compile(r'(?:[0-9a-f]{40}-[0-9]+-[0-9]+|bootstrap-[0-9]{14})')
GITHUB_LOCK = Lock()
SOCKET = Path('/run/sunrise-status/refresh.sock')


def utc_now():
    return datetime.now(timezone.utc).isoformat()


class RefreshRejected(Exception):
    def __init__(self, status, error, retry_after):
        self.status, self.error, self.retry_after = status, error, retry_after


def github_requests():
    return [stamp for stamp in read_json(PRIVATE / 'github-budget.json').get('requests', [])
            if 0 <= time.time() - stamp < 3600]


def github_retry_after(requests):
    return max(1, math.ceil(min(requests) + 3600 - time.time()))


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def save(path, value, mode):
    pending = path.with_suffix('.next')
    pending.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    pending.chmod(mode)
    pending.replace(path)


def fetch(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    try:
        response = urllib.request.urlopen(request, timeout=8)
    except urllib.error.HTTPError as error:
        response = error  # Terminus includes useful per-service results in HTTP 503.
    with response:
        return response.status, response.read(2 * 1024 * 1024)


def command(args):
    return subprocess.run(args, cwd=BASE, capture_output=True, text=True,
                          timeout=10, check=True).stdout.strip()


def frontend():
    result = {'status': 'down', 'version': None, 'lastDeployedAt': None}
    try:
        code, html = fetch('https://ops-dev.sunrisevacation.cn/')
        marker_code, raw = fetch('https://ops-dev.sunrisevacation.cn/__deploy.json')
        marker = json.loads(raw)
        version = marker.get('release', '')
        if code == 200 and b'<html' in html.lower() and marker_code == 200 and RELEASE.fullmatch(version):
            result.update(status='up', version=version)
        record = read_json(BASE / 'frontend/last-deployment.json')
        if result['version'] == record.get('release') and record.get('verified') is True:
            result['lastDeployedAt'] = record.get('deployedAt')
    except (OSError, ValueError):
        pass
    return result


def backend():
    result = {'status': 'down', 'version': None, 'lastDeployedAt': None}
    try:
        code, raw = fetch('https://api-dev.sunrisevacation.cn/api/health')
        data = json.loads(raw)
        if code in (200, 503) and data.get('details', {}).get('api', {}).get('status') == 'up':
            result['status'] = 'up'
    except (OSError, ValueError):
        pass
    state = read_json(BASE / 'backend/state.json')
    version = state.get('current', '')
    if RELEASE.fullmatch(version):
        record = read_json(BASE / 'backend/releases' / (version + '.json'))
        try:
            actual = command(['docker', 'inspect', 'sunrise-travelops-dev-api-1', '--format', '{{.Image}}'])
            if actual == record.get('image'):
                result.update(version=version, lastDeployedAt=state.get('last_deployed_at'))
        except (OSError, subprocess.SubprocessError):
            pass
    return result


def database():
    result = {'status': 'down', 'version': None, 'lastDeployedAt': None, 'lastMigratedAt': None}
    prefix = COMPOSE + ['exec', '-T', 'postgres', 'psql', '-U', 'travelops', '-d', 'travelops_dev',
                        '-v', 'ON_ERROR_STOP=1', '-At', '-c']
    try:
        if command(prefix + ['SELECT 1']) != '1':
            return result
        result['status'] = 'up'
        result['version'] = command(prefix + ['SELECT name FROM migrations ORDER BY id DESC LIMIT 1']) or None
        result['lastMigratedAt'] = read_json(BASE / 'backend/state.json').get('last_migrated_at')
    except (OSError, subprocess.SubprocessError):
        pass
    return result


def github(path):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'sunrise-status'}
    token = os.environ.get('STATUS_GITHUB_TOKEN')
    if token:
        headers['Authorization'] = 'Bearer ' + token
    else:
        # Both workflow workers share this budget; all collections also hold flock.
        with GITHUB_LOCK:
            requests = github_requests()
            if len(requests) >= 48:
                raise ValueError('GitHub request budget exhausted')
            save(PRIVATE / 'github-budget.json', {'requests': requests + [time.time()]}, 0o600)
    code, raw = fetch('https://api.github.com/repos/' + path, headers)
    if code != 200:
        raise ValueError('GitHub status unavailable')
    return json.loads(raw)


def deployment(service):
    result = {'status': 'unknown', 'sha': None, 'updatedAt': None, 'url': None, 'failedStage': None, 'latestPush': None}
    repo, workflow = WORKFLOWS[service]
    try:
        runs = github(repo + '/actions/workflows/' + workflow + '/runs?branch=main&per_page=100')['workflow_runs']
        runs = [run for run in runs if run['head_branch'] == 'main' and run['event'] in ('push', 'workflow_dispatch')]
        if not runs:
            return result
        pushes = [run for run in runs if run['event'] == 'push']
        if pushes:
            push = max(pushes, key=lambda run: run['run_number'])
            commit = push.get('head_commit') or {}
            message = (commit.get('message') or '').splitlines()
            result['latestPush'] = {
                'sha': push['head_sha'], 'message': message[0] if message else None,
                'author': (commit.get('author') or {}).get('name'),
                'url': f'https://github.com/{repo}/commit/{push["head_sha"]}',
            }
        latest = max(runs, key=lambda run: (run['run_number'], run['run_attempt']))
        status = 'running'
        if latest['status'] == 'completed':
            status = latest['conclusion'] if latest['conclusion'] in ('success', 'cancelled') else 'failure'
        result.update(status=status, sha=latest['head_sha'], updatedAt=latest['updated_at'],
                      url=f'https://github.com/{repo}/actions/runs/{latest["id"]}')
        if status == 'failure':
            try:
                jobs = github(f'{repo}/actions/runs/{latest["id"]}/jobs?per_page=100')['jobs']
                failed = [job['name'] for job in jobs if job['conclusion'] in ('failure', 'timed_out', 'action_required')]
                result['failedStage'] = ', '.join(failed) or None
            except (OSError, ValueError, KeyError):
                pass  # A failed jobs lookup must never erase a known failed run.
    except (OSError, ValueError, KeyError):
        pass
    return result


def cached_deployment(service, force=False):
    # Public GitHub API allows 60 unauthenticated requests/hour per source IP.
    # Two workflows plus failed-job details stay below that at five-minute intervals.
    path = PRIVATE / (service + '-actions.json')
    cached = read_json(path)
    if not force and 0 <= time.time() - cached.get('fetchedAt', 0) < 300:
        return cached['result']
    result = deployment(service)
    result['checkedAt'] = utc_now()
    save(path, {'fetchedAt': time.time(), 'result': result}, 0o600)
    return result


NAMES = {'frontend': '前端', 'backend': '后端', 'database': '数据库'}
STATUS_LABELS = {'up': '正常', 'down': '异常', 'unknown': '未知',
                 'success': '成功', 'failure': '失败', 'cancelled': '已取消', 'running': '进行中'}


def mail_time(value):
    if not value:
        return '尚无记录'
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(
            timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M:%S')
    except (ValueError, TypeError):
        return '尚无记录'


def notification_content(snapshot, incidents):
    title = '状态异常 / 发布需处理' if incidents else '服务与发布状态已恢复'
    issues = []
    for key in incidents:
        name = key.removesuffix('-deploy')
        if key.endswith('-deploy'):
            item = snapshot['deployments'].get(name, {})
            state = item.get('status', 'unknown')
            label = '重试中，等待恢复确认' if state == 'running' else STATUS_LABELS.get(state, '未知')
            issues.append(NAMES.get(name, name) + '发布：' + label)
        else:
            issues.append(NAMES.get(name, name) + '服务：' + STATUS_LABELS.get(incidents[key], '未知'))
    summary = '；'.join(issues) if issues else '当前服务正常，发布告警已解除。'
    checked = mail_time(snapshot.get('checkedAt'))
    plain = [title, summary, '检测时间：' + checked + '（北京时间）', '', '服务状态']
    rows = []
    for name, item in snapshot['services'].items():
        label = NAMES.get(name, name)
        status = STATUS_LABELS.get(item.get('status'), '未知')
        version = item.get('version') or '尚无记录'
        time_label = '迁移时间' if name == 'database' else '部署时间'
        stamp = mail_time(item.get('lastMigratedAt' if name == 'database' else 'lastDeployedAt'))
        plain.append(f'{label}：{status} | 版本：{version} | {time_label}：{stamp}')
        color = '#15803d' if item.get('status') == 'up' else '#b91c1c'
        rows.append(f'<tr><td style="padding:12px;border-bottom:1px solid #e2e8f0">{escape(label)}</td>'
                    f'<td style="padding:12px;color:{color};font-weight:bold">{escape(status)}</td>'
                    f'<td style="padding:12px;font-size:12px;word-break:break-all">{escape(version)}'
                    f'<br><span style="color:#64748b">{time_label}：{stamp}</span></td></tr>')
    cards = []
    for name, item in snapshot['deployments'].items():
        label = NAMES.get(name, name)
        status = STATUS_LABELS.get(item.get('status'), '未知')
        push = item.get('latestPush') or {}
        fields = [('最新流水线', status), ('流水线提交', (item.get('sha') or '尚无记录')[:12]),
                  ('流水线更新时间', mail_time(item.get('updatedAt'))),
                  ('发布信息查询时间', mail_time(item.get('checkedAt')))]
        if item.get('failedStage'):
            fields.append(('失败阶段', item['failedStage']))
        fields += [('最近 main push', push.get('message') or '尚无记录'),
                   ('提交作者', push.get('author') or '尚无记录'),
                   ('提交 SHA', (push.get('sha') or '尚无记录')[:12])]
        plain += ['', label + '发布'] + [f'{key}：{value}' for key, value in fields]
        details = ''.join(f'<tr><td style="padding:5px 0;width:140px;color:#64748b;vertical-align:top">{escape(key)}</td>'
                          f'<td style="padding:5px 0;word-break:break-word">{escape(str(value))}</td></tr>' for key, value in fields)
        links = []
        for caption, url in [('查看流水线', item.get('url')), ('查看提交', push.get('url'))]:
            if url and url.startswith('https://github.com/'):
                plain.append(caption + '：' + url)
                links.append(f'<a href="{escape(url, quote=True)}" style="color:#2563eb">{caption}</a>')
        cards.append(f'<h2 style="font-size:17px;margin:24px 0 10px">{escape(label)}发布</h2>'
                     f'<table role="presentation" width="100%" style="font-size:14px">{details}</table>'
                     f'<p>{" &nbsp; · &nbsp; ".join(links)}</p>')
    url = 'https://status.sunrisevacation.cn/'
    plain += ['', '查看完整状态：' + url, '所有时间均为北京时间（UTC+8）。']
    color = '#b91c1c' if incidents else '#15803d'
    html = f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="margin:0;background:#f1f5f9;font-family:Arial,'Microsoft YaHei',sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:white;border:1px solid #e2e8f0"><tr><td style="padding:28px">
<p style="font-size:12px;letter-spacing:2px;color:#64748b;margin:0">SUNRISE · DEV 开发环境</p>
<h1 style="font-size:24px;color:{color};margin:14px 0">{title}</h1><p style="line-height:1.7">{escape(summary)}</p>
<p style="font-size:12px;color:#64748b">检测时间：{checked} · 北京时间</p>
<h2 style="font-size:17px;margin-top:28px">服务状态</h2><table role="presentation" width="100%" cellspacing="0" style="font-size:14px">{''.join(rows)}</table>
{''.join(cards)}<p style="margin-top:28px"><a href="{url}" style="background:#2563eb;color:white;padding:12px 20px;display:inline-block;text-decoration:none">查看完整状态</a></p>
<p style="font-size:12px;color:#64748b">所有时间均为北京时间（UTC+8）。最近 push 与当前在线版本分别展示。</p>
</td></tr></table></td></tr></table></body></html>'''
    return '\n'.join(plain), html


def notify(snapshot):
    required = ('STATUS_SMTP_HOST', 'STATUS_SMTP_FROM', 'STATUS_SMTP_TO')
    if not all(os.environ.get(key) for key in required):
        return 'unconfigured'
    previous = read_json(PRIVATE / 'notifications.json')
    incidents = {name: item['status'] for name, item in snapshot['services'].items() if item['status'] != 'up'}
    for name, item in snapshot['deployments'].items():
        if item['status'] in ('failure', 'cancelled', 'unknown'):
            incidents[name + '-deploy'] = item['status'] + ':' + (item['url'] or '') + ':' + (item['updatedAt'] or '')
        elif item['status'] == 'running' and name + '-deploy' in previous.get('incidents', {}):
            incidents[name + '-deploy'] = previous['incidents'][name + '-deploy']
    if previous.get('incidents') == incidents or (not previous and not incidents):
        return 'ready'
    message = EmailMessage()
    message['From'] = os.environ['STATUS_SMTP_FROM']
    message['To'] = os.environ['STATUS_SMTP_TO']
    message['Subject'] = '[Sunrise DEV] ' + ('状态异常 / 发布需处理' if incidents else '服务与发布状态已恢复')
    plain, html = notification_content(snapshot, incidents)
    message.set_content(plain)
    message.add_alternative(html, subtype='html')
    try:
        with smtplib.SMTP_SSL(os.environ['STATUS_SMTP_HOST'], int(os.environ.get('STATUS_SMTP_PORT', '465')),
                              timeout=10, context=ssl.create_default_context()) as client:
            if os.environ.get('STATUS_SMTP_USER'):
                client.login(os.environ['STATUS_SMTP_USER'], os.environ['STATUS_SMTP_PASSWORD'])
            client.send_message(message)
        save(PRIVATE / 'notifications.json', {'incidents': incidents}, 0o600)
        return 'sent'
    except (OSError, ValueError, KeyError, smtplib.SMTPException):
        return 'failed'  # Do not acknowledge; retry next collection.


def probe_service(fn):
    result = fn()
    result['checkedAt'] = utc_now()
    return result


def collect(force=False):
    PUBLIC.mkdir(exist_ok=True, mode=0o755)
    PRIVATE.mkdir(exist_ok=True, mode=0o700)
    PUBLIC.chmod(0o755)
    with ThreadPoolExecutor(max_workers=5) as pool:
        probes = {name: pool.submit(probe_service, fn) for name, fn in
                  [('frontend', frontend), ('backend', backend), ('database', database)]}
        workflows = {name: pool.submit(cached_deployment, name, force) for name in WORKFLOWS}
        snapshot = {'environment': 'development', 'staleAfterSeconds': 180,
                    'services': {name: future.result() for name, future in probes.items()},
                    'deployments': {name: future.result() for name, future in workflows.items()}}
    snapshot['checkedAt'] = utc_now()
    snapshot['notification'] = notify(snapshot)
    save(PUBLIC / 'status.json', snapshot, 0o644)
    return snapshot


def run_collection(manual=False):
    PRIVATE.mkdir(exist_ok=True, mode=0o700)
    with (PRIVATE / 'collection.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RefreshRejected(409, 'collection_in_progress', 5)
        if manual:
            previous = read_json(PRIVATE / 'manual-refresh.json').get('startedAt', 0)
            remaining = math.ceil(previous + 60 - time.time())
            if remaining > 0:
                raise RefreshRejected(429, 'refresh_cooldown', remaining)
            requests = github_requests()
            # Reserve room for two workflow calls and up to two failed-job lookups.
            if not os.environ.get('STATUS_GITHUB_TOKEN') and len(requests) > 44:
                # Enough entries must expire to leave four requests available.
                retry = github_retry_after(sorted(requests)[len(requests) - 45:])
                raise RefreshRejected(429, 'github_budget_exhausted', retry)
            save(PRIVATE / 'manual-refresh.json', {'startedAt': time.time()}, 0o600)
        return collect(force=manual)


class RefreshHandler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(10)
        super().setup()

    def respond(self, status, value, retry_after=None):
        raw = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        if retry_after is not None:
            self.send_header('Retry-After', str(retry_after))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        if self.path != '/refresh':
            return self.respond(404, {'error': 'not_found'})
        if (self.headers.get('X-Status-Refresh') != '1'
                or self.headers.get('Origin') not in (None, 'https://status.sunrisevacation.cn')):
            return self.respond(403, {'error': 'forbidden'})
        if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length', '0') != '0':
            return self.respond(400, {'error': 'body_not_allowed'})
        try:
            snapshot = run_collection(manual=True)
        except RefreshRejected as error:
            return self.respond(error.status, {'error': error.error}, error.retry_after)
        except Exception:
            return self.respond(503, {'error': 'collection_failed'})
        self.respond(200, snapshot)

    def do_GET(self):
        self.respond(405, {'error': 'method_not_allowed'})

    def log_message(self, *_args):
        pass  # Do not log arbitrary request data in the root service.


def serve():
    SOCKET.unlink(missing_ok=True)
    with socketserver.UnixStreamServer(str(SOCKET), RefreshHandler) as server:
        SOCKET.chmod(0o666)  # Nginx reaches only this fixed-action Unix socket.
        server.serve_forever()


if __name__ == '__main__':
    if sys.argv[1:] == ['--serve']:
        serve()
    else:
        try:
            run_collection()
        except RefreshRejected:
            pass  # A manual collection already owns this timer tick.
