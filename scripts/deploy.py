#!/usr/bin/python3
"""Local release operations; called under the host build lock by trusted Actions."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import signal
import time
import urllib.request

ENVIRONMENT = os.environ.get('DEPLOY_ENV', 'dev')
if ENVIRONMENT not in ('dev', 'prod'):
    raise ValueError('Invalid environment')
BASE = Path('/opt/sunrise-travelops-' + ENVIRONMENT)
STATE = BASE / 'backend'
COMPOSE = ['docker', 'compose', '--env-file', 'server.env', '-f', 'compose.ecs.yml']
if ENVIRONMENT == 'dev':
    COMPOSE += ['-f', 'compose.dev.yml']
ID = re.compile(r'(?:[0-9a-f]{40}-[0-9]+-[0-9]+|bootstrap-[0-9]{14})')
# This destructive schema was previously misregistered as backward compatible.
# Never trust that historical flag for rollback or ordinary online migration.
BREAKING_MIGRATIONS = {
    'RetireUnusedPermissions1793577600000',
    'WebsiteSequenceAndDraft1793491200000',
    'AddBusinessGroupsAndCoordinatorDuty1793145600000',
    'ReviseTravelPlanning1788912000000',
    'StructureBusinessAndIdentity1789459200000',
    'ReleaseDeletedUsernames1789459400000',
    'ConvertLynxVisitsToWhatsappRegistry1789521600000',
    'AddPaxTierQuotes1790006400000',
    'ShareItineraryStaffCosts1790006600000',
    'RemoveGuideServiceTotal1790040600000',
    'UnifyResourceLibrary1791619200000',
    'DropUnusedItineraryFields1791705600000',
    'UseHotelDiamondRatings1791878400000',
    'FlattenAttractionAndRestaurantResources1791964800000',
    'AddMenuPermissionsAndWebsiteBusinessScope1792051200000',
    'AllowManualToursAndGuideSnapshots1792368000000',
    'AddItineraryDayRecycle1792627200000',
    'UpdateDirectLedgerWorkflow1792713600000',
    'UpdateWebsiteInquiryFields1792886400000',
    'AddWebsiteVisitLedger1792972800000',
}
INSPECT_MIGRATIONS = """
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const result = {};
for (const file of fs.readdirSync('/app/dist/migrations').filter(f => f.endsWith('.js'))) {
  const full = path.join('/app/dist/migrations', file);
  for (const Type of Object.values(require(full))) {
    if (typeof Type !== 'function' || !Type.prototype.up) continue;
    const name = new Type().name || Type.name;
    if (result[name]) throw new Error('Duplicate migration: ' + name);
    result[name] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  }
}
console.log(JSON.stringify(result));
"""


class MigrationRequired(ValueError):
    """The candidate needs migration review/maintenance before it can be deployed."""


def public_diagnostic(text):
    # Actions logs are public. Keep SQL/row output in the private operations log.
    text = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', str(text))
    secrets = dict(os.environ)
    try:
        for line in (BASE / 'server.env').read_text().splitlines():
            key, separator, value = line.partition('=')
            if separator:
                secrets[key.strip()] = value.strip().strip('\"\'')
    except OSError:
        pass
    for key, value in secrets.items():
        if value and re.search(r'PASSWORD|SECRET|TOKEN|(?:^|_)KEY$|(?:^|_)URL$', key, re.I):
            text = text.replace(value, '***')
    text = re.sub(r'(\w+://)[^\s/@]+:[^\s/@]+@', r'\1***@', text)
    text = re.sub(r'(?i)(authorization\s*[:=]\s*)(?:Bearer|Basic)\s+\S+', r'\1***', text)
    text = re.sub(r'(?i)(password|token|secret|authorization)(\s*[:=]\s*)[^\s,;]+', r'\1\2***', text)
    lines = []
    sql_block = False
    for line in text.splitlines():
        if not line.strip():
            sql_block = False
        if re.search(r'(?i)\b(query|parameters|detail|context|failing row)\s*:|\b(SELECT|INSERT INTO|UPDATE .* SET|DELETE FROM)\b', line):
            sql_block = True
            lines.append('[SQL/row details omitted; see backend/operations.log]')
        elif not sql_block:
            # Child output must never become an Actions workflow command.
            lines.append(line.replace('::', ': :'))
    return '\n'.join(lines[-20:])[:4000]


def report_result(level, title, detail):
    detail = public_diagnostic(detail)
    print(title + ': ' + detail, file=sys.stderr)
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        escaped = detail.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
        print(f'::{level} title={title}::{escaped}', file=sys.stderr)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as file:
            file.write('\n### ' + title + '\n\n' + '\n'.join('    ' + line for line in detail.splitlines()) + '\n')


def run(command, env=None, input_file=None):
    label = ' '.join(command[:2])
    try:
        result = subprocess.run(command, cwd=BASE, env=env, stdin=input_file,
                                capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(label + ' timed out after 300 seconds') from error
    if result.returncode:
        detail = public_diagnostic(result.stderr) or 'No stderr; see backend/operations.log'
        try:
            with (STATE / 'operations.log').open('a') as log:
                log.write(now() + '\n' + json.dumps(command) + '\n' + result.stdout + result.stderr + '\n')
        except OSError as error:
            detail += '\nCould not write backend/operations.log: ' + public_diagnostic(error)
        raise RuntimeError(f'{label} failed (exit {result.returncode}): {detail}')
    return result.stdout.strip()


def save(path, value):
    temporary = path.with_suffix(path.suffix + '.next')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def now():
    return datetime.now(timezone.utc).isoformat()


def read_state():
    path = STATE / 'state.json'
    if not path.exists() and ENVIRONMENT == 'prod':
        return {'current': None, 'previous': None, 'migration_history': {}, 'compatible_migrations': []}
    return json.loads(path.read_text())


def preflight():
    """Fail before a costly build if maintenance left private files inaccessible."""
    if os.geteuid() == 0:
        raise PermissionError('Run release operations as sunrise-runner, not root')
    for path in (BASE, STATE, STATE / 'releases'):
        if not os.access(path, os.R_OK | os.W_OK | os.X_OK):
            raise PermissionError(f'Release directory is not accessible/writable: {path}')
    paths = [BASE / 'server.env', STATE / 'state.json']
    log = STATE / 'operations.log'
    if log.exists():
        paths.append(log)
    for path in paths:
        if not os.access(path, os.R_OK | os.W_OK):
            raise PermissionError(f'Release file is not readable/writable: {path}')
    state = read_state()
    for key in ('current', 'previous'):
        if state.get(key):
            release(state[key])
    return {'preflight': 'passed'}


def release(release_id):
    if not ID.fullmatch(release_id):
        raise ValueError('Invalid release ID')
    return json.loads((STATE / 'releases' / (release_id + '.json')).read_text())


def migrations(image):
    return json.loads(run(['docker', 'run', '--rm', '--network', 'none',
                           '--entrypoint', 'node', image, '-e', INSPECT_MIGRATIONS]))


def applied():
    return run(COMPOSE + ['exec', '-T', 'postgres', 'psql', '-U', 'travelops',
                          '-d', 'travelops_' + ENVIRONMENT, '-At', '-c',
                          'SELECT name FROM migrations ORDER BY id']).splitlines()


def check_schema(target, current, database, compatible, allow_migrations=False):
    for name in database:
        if name in target and name in current and target[name] != current[name]:
            raise ValueError('Previously executed migration changed: ' + name)
    missing = set(database) - target.keys()
    if missing & BREAKING_MIGRATIONS:
        raise ValueError('Rollback crosses a destructive migration; database recovery plan required')
    if missing - set(compatible):
        raise ValueError('Target does not support current database migrations: ' +
                         ', '.join(sorted(missing - set(compatible))))
    pending = target.keys() - set(database)
    if pending & BREAKING_MIGRATIONS:
        raise MigrationRequired('Destructive migration requires a separate maintenance plan, not compatibility confirmation. '
                                'Pending migrations: ' + ', '.join(sorted(pending)))
    if pending and not allow_migrations:
        raise ValueError('Pending migrations require manual backward-compatibility confirmation: ' +
                         ', '.join(sorted(pending)))
    return sorted(pending)


def set_image(image):
    path = BASE / 'server.env'
    lines = path.read_text().splitlines()
    if sum(line.startswith('API_IMAGE=') for line in lines) != 1:
        raise ValueError('Expected exactly one API_IMAGE in server.env')
    text = '\n'.join('API_IMAGE=' + image if line.startswith('API_IMAGE=') else line
                     for line in lines) + '\n'
    temporary = path.with_name('server.env.next')
    temporary.write_text(text)
    temporary.chmod(0o600)
    temporary.replace(path)


def activate(image):
    set_image(image)
    run(COMPOSE + ['up', '-d', '--no-deps', 'api'])
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        info = json.loads(run(['docker', 'inspect', 'sunrise-travelops-' + ENVIRONMENT + '-api-1']))[0]
        if info['Image'] == image and info['State'].get('Health', {}).get('Status') == 'healthy':
            break
        if info['State']['Status'] in ['exited', 'dead', 'restarting'] or info['State'].get('Health', {}).get('Status') == 'unhealthy':
            raise RuntimeError('API exited or became unhealthy during deployment')
        time.sleep(3)
    else:
        raise RuntimeError('API did not become healthy within 90 seconds')
    # Validate the shared ingress locally even before new public DNS/TLS is ready.
    host = 'api-dev.sunrisevacation.cn' if ENVIRONMENT == 'dev' else 'api.sunrisevacation.cn'
    request = urllib.request.Request('http://127.0.0.1:8089/api/health', headers={'Host': host})
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.load(response)
    if result.get('status') != 'ok' or result.get('details', {}).get('postgres', {}).get('status') != 'up':
        raise RuntimeError('Ingress API/PostgreSQL health check failed')


def activate_or_restore(candidate, previous):
    try:
        activate(candidate)
    except Exception as failure:
        if previous is None:
            run(COMPOSE + ['stop', 'api'])
            raise RuntimeError('Deployment failed without a compatible rollback image; candidate API stopped') from failure
        try:
            activate(previous)
        except Exception as restore_failure:
            raise RuntimeError('Deployment and application rollback failed; operator attention required') from restore_failure
        raise RuntimeError('Deployment failed; previous application restored: ' + str(failure)) from failure


def cleanup_plan():
    state = read_state()
    records = {}
    for path in (STATE / 'releases').glob('*.json'):
        if path.is_symlink() or not ID.fullmatch(path.stem):
            raise ValueError('Unsafe release record')
        records[path.stem] = (json.loads(path.read_text()), path.stat().st_mtime)
    protected = {state['current'], state['previous']} - {None}
    if not protected <= records.keys():
        raise ValueError('Missing protected release record')
    recent = sorted((stamp, name) for name, (record, stamp) in records.items()
                    if record.get('status') == 'verified')[-3:]
    protected.update(name for _, name in recent)
    ids = run(['docker', 'ps', '-aq']).split()
    used = {item['Image'] for item in json.loads(run(['docker', 'inspect', *ids]))} if ids else set()
    protected.update(name for name, (record, _) in records.items() if record['image'] in used)
    for environment in ('dev', 'prod'):
        for record in Path('/opt/sunrise-travelops-' + environment + '/backend/releases').glob('*.json'):
            info = json.loads(record.read_text())
            if info.get('status') == 'verified':
                used.add(info['image'])
    protected_images = used | {records[name][0]['image'] for name in protected}
    tags = run(['docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}',
                'sunrise-travelops-api']).splitlines()
    tags = [tag for tag in tags if tag.startswith('sunrise-travelops-api:') and not tag.endswith(':<none>')]
    images = json.loads(run(['docker', 'image', 'inspect', *tags])) if tags else []
    removable_tags = sorted({tag for info in images if info['Id'] not in protected_images
                             for tag in info.get('RepoTags') or [] if tag in tags})
    return {'keep': sorted(protected), 'removeRecords': sorted(records.keys() - protected),
            'removeImageTags': removable_tags, 'cacheUntil': '168h'}


def cleanup():
    plan = cleanup_plan()
    for tag in plan['removeImageTags']:
        run(['docker', 'image', 'rm', tag])  # No force: Docker also protects container references.
    for name in plan['removeRecords']:
        (STATE / 'releases' / (name + '.json')).unlink()
    # BuildKit cache GC is bounded by the dedicated builder configuration.
    return plan


def cleanup_after_success():
    try:
        print(json.dumps({'cleanup': cleanup()}), file=sys.stderr)
    except Exception as error:
        print('::warning::Backend release cleanup failed: ' + str(error), file=sys.stderr)


def publish(release_id, image, allow_migrations=False):
    if not ID.fullmatch(release_id):
        raise ValueError('Invalid release ID')
    record_path = STATE / 'releases' / (release_id + '.json')
    if record_path.exists():
        raise ValueError('Release already exists; use a new run attempt')
    state = read_state()
    previous = release(state['current']) if state['current'] else None
    target = migrations(image)
    database = applied()
    if previous is None and set(database) != set(target):
        raise ValueError('Initial production database must be initialized before first release')
    # The current image can be an older rollback target; preserve the complete applied history separately.
    pending = check_schema(target, state['migration_history'], database,
                           state['compatible_migrations'], allow_migrations)
    if pending:
        environment = os.environ.copy()
        environment['API_IMAGE'] = image
        migration_container = 'sunrise-api-migrate-' + release_id
        try:
            run(COMPOSE + ['run', '--rm', '--no-deps', '--name', migration_container,
                           'migrate', 'node', 'node_modules/typeorm/cli.js',
                           'migration:run', '-d', 'dist/database/data-source.js',
                           '--transaction', 'all'], env=environment)
        except Exception:
            # Killing a timed-out CLI alone would leave its migration container running.
            subprocess.run(['docker', 'rm', '-f', migration_container], capture_output=True, timeout=30)
            raise
        if set(applied()) != set(database) | set(pending):
            raise RuntimeError('Unexpected migration history; application was not switched')
        state['compatible_migrations'] = sorted(set(state['compatible_migrations']) | set(pending))
        state['migration_history'].update(target)
        state['last_migrated_at'] = now()
        save(STATE / 'state.json', state)
    rollback_image = None
    if previous:
        try:
            check_schema(previous['migrations'], state['migration_history'],
                         sorted(set(database) | set(pending)), state['compatible_migrations'])
            rollback_image = previous['image']
        except ValueError:
            # Maintenance may make the previous application unsafe; restore the database first.
            pass
    record = {'release': release_id, 'image': image, 'migrations': target,
              'previous': state['current'], 'status': 'pending'}
    save(record_path, record)
    try:
        activate_or_restore(image, rollback_image)
    except Exception:
        record['status'] = 'failed'
        save(record_path, record)
        raise
    record['status'] = 'verified'
    record['deployed_at'] = now()
    save(record_path, record)
    state['previous'] = state['current']
    state['current'] = release_id
    state['last_deployed_at'] = record['deployed_at']
    state['migration_history'].update(target)
    save(STATE / 'state.json', state)
    cleanup_after_success()
    return {'release': release_id, 'previous': state['previous'], 'verified': True}


def rollback(target_id):
    state = read_state()
    if target_id == 'previous':
        target_id = state.get('previous')
    if not target_id:
        raise ValueError('No previous release available')
    target = release(target_id)
    current = release(state['current'])
    if target['status'] != 'verified':
        raise ValueError('Rollback target was not verified')
    check_schema(target['migrations'], state['migration_history'], applied(),
                 state['compatible_migrations'])
    # Ensure the immutable image still exists before touching the running service.
    run(['docker', 'image', 'inspect', target['image'], '--format', '{{.Id}}'])
    activate_or_restore(target['image'], current['image'])
    state['previous'] = state['current']
    state['current'] = target_id
    state['last_deployed_at'] = now()
    save(STATE / 'state.json', state)
    cleanup_after_success()
    return {'release': target_id, 'previous': state['previous'], 'verified': True}


def bootstrap():
    if (STATE / 'state.json').exists():
        raise ValueError('Deployment state is already initialized')
    release_id = 'bootstrap-' + time.strftime('%Y%m%d%H%M%S')
    image = run(['docker', 'inspect', 'sunrise-travelops-' + ENVIRONMENT + '-api-1', '--format', '{{.Image}}'])
    target = migrations(image)
    if set(applied()) != set(target):
        raise ValueError('Bootstrap image and database migrations do not match')
    save(STATE / 'releases' / (release_id + '.json'), {
        'release': release_id, 'image': image, 'migrations': target,
        'previous': None, 'status': 'verified',
    })
    save(STATE / 'state.json', {'current': release_id, 'previous': None,
                              'compatible_migrations': [], 'migration_history': target})
    return {'current': release_id, 'image': image}


def main():
    os.umask(0o077)
    if sys.argv[1:] == ['preflight']:
        print(json.dumps(preflight()))
        return
    STATE.mkdir(exist_ok=True)
    (STATE / 'releases').mkdir(exist_ok=True)
    args = sys.argv[1:]
    if args == ['status']:
        state = read_state()
        print(json.dumps({'current': state['current'], 'previous': state['previous']}))
        return
    # Finish the bounded activation or restoration even if Actions is cancelled.
    for signum in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, signal.SIG_IGN)
    if os.environ.get('SUNRISE_LOCK_HELD') != '1':
        raise ValueError('Run through the workflow holding /opt/sunrise-ci/build.lock')
    if args == ['bootstrap']:
        result = bootstrap()
    elif len(args) == 2 and args[0] == 'rollback':
        result = rollback(args[1])
    elif len(args) == 3 and args[0] == 'deploy':
        release_id, tag = args[1:]
        info = json.loads(run(['docker', 'image', 'inspect', tag]))[0]
        sha = release_id.split('-')[0]
        if info['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != sha:
            raise ValueError('Image does not match requested commit')
        target = migrations(info['Id'])
        state = read_state()
        database = applied()
        # Schema corruption and incompatible rollback remain real failures, even if migrations are pending.
        pending = set(check_schema(target, state['migration_history'], database,
                                   state['compatible_migrations'], allow_migrations=True))
        reviewed = set(filter(None, os.environ.get('REVIEWED_MIGRATIONS', '').split(',')))
        if pending and pending != reviewed:
            raise MigrationRequired('Review compatibility and rerun with these exact pending migrations: ' + ','.join(sorted(pending)))
        result = publish(release_id, info['Id'], bool(pending))
    else:
        raise ValueError('Expected preflight, status, bootstrap, deploy <release> <image>, or rollback <release|previous>')
    print(json.dumps(result))


def cli():
    try:
        main()
        return 0
    except MigrationRequired as error:
        if sys.argv[1:2] == ['deploy']:
            report_result('warning', 'Waiting for migration - NOT deployed', error)
            return 78
        report_result('error', 'Backend deployment failed', error)
        return 1
    except Exception as error:
        report_result('error', 'Backend deployment failed', error)
        return 1


if __name__ == '__main__':
    sys.exit(cli())
