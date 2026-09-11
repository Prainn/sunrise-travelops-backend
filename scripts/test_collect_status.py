import importlib.util
import fcntl
import http.client
from http.server import HTTPServer
import json
import os
from pathlib import Path
import smtplib
import subprocess
import tempfile
from threading import Thread
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location('collector', Path(__file__).with_name('collect-status.py'))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class StatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        for name in ['BASE', 'PRIVATE']:
            patcher = patch.object(collector, name, self.base)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_api_is_up_when_only_database_health_failed(self):
        payload = {'details': {'api': {'status': 'up'}, 'postgres': {'status': 'down'}}}
        with patch.object(collector, 'fetch', return_value=(503, json.dumps(payload).encode())):
            self.assertEqual(collector.backend()['status'], 'up')

    def test_api_network_failure_is_down_without_inventing_version(self):
        with patch.object(collector, 'fetch', side_effect=OSError('network')):
            self.assertEqual(collector.backend(), {'status': 'down', 'version': None, 'lastDeployedAt': None})

    def test_database_is_probed_independently_and_no_time_is_invented(self):
        with patch.object(collector, 'command', side_effect=['1', 'LatestMigration']):
            result = collector.database()
        self.assertEqual(result['status'], 'up')
        self.assertEqual(result['version'], 'LatestMigration')
        self.assertIsNone(result['lastMigratedAt'])
        with patch.object(collector, 'command', side_effect=subprocess.TimeoutExpired('psql', 10)):
            self.assertEqual(collector.database()['status'], 'down')

    def test_frontend_requires_real_html_and_valid_release_marker(self):
        with patch.object(collector, 'fetch', side_effect=[(200, b'<html>app</html>'), (200, b'{"release":"bootstrap-20260910120000"}')]):
            result = collector.frontend()
        self.assertEqual(result['status'], 'up')
        self.assertIsNone(result['lastDeployedAt'])
        with patch.object(collector, 'fetch', side_effect=[(200, b'<html>error</html>'), (200, b'<html>fallback</html>')]):
            self.assertEqual(collector.frontend()['status'], 'down')

    def test_new_failed_deploy_is_not_hidden_by_old_success_or_pr(self):
        runs = []
        for number, event, conclusion in [(1, 'push', 'success'), (2, 'push', 'failure'), (3, 'pull_request', 'success')]:
            runs.append({'id': number, 'head_branch': 'main', 'event': event, 'run_number': number,
                         'run_attempt': 1, 'status': 'completed', 'conclusion': conclusion,
                         'head_sha': str(number) * 40, 'updated_at': '2026-09-10T00:00:00Z'})
        with patch.object(collector, 'github', side_effect=[{'workflow_runs': runs}, {'jobs': [{'name': 'verify', 'conclusion': 'failure'}]}]):
            result = collector.deployment('backend')
        self.assertEqual(result['status'], 'failure')
        self.assertEqual(result['failedStage'], 'verify')
        self.assertTrue(result['url'].endswith('/2'))
        with patch.object(collector, 'github', side_effect=[{'workflow_runs': runs}, OSError('unavailable')]):
            self.assertEqual(collector.deployment('backend')['status'], 'failure')

    def test_latest_push_metadata_is_not_manual_run_or_actor(self):
        runs = [dict(id=n, head_branch='main', event=event, run_number=n, run_attempt=1,
                     status='completed', conclusion='success', head_sha=str(n) * 40,
                     updated_at='2026-09-10T00:00:00Z', actor={'login': 'operator'},
                     head_commit={'message': '修复邮件 <布局>\n\n正文', 'author': {'name': 'Joe', 'email': 'private@example.test'}})
                for n, event in [(1, 'push'), (2, 'push'), (3, 'workflow_dispatch')]]
        with patch.object(collector, 'github', return_value={'workflow_runs': runs}) as github:
            result = collector.deployment('backend')
        self.assertEqual(result['sha'], '3' * 40)
        self.assertEqual(result['latestPush'], {
            'sha': '2' * 40, 'message': '修复邮件 <布局>', 'author': 'Joe',
            'url': 'https://github.com/Prainn/sunrise-travelops-backend/commit/' + '2' * 40})
        github.assert_called_once()
        with patch.object(collector, 'github', return_value={'workflow_runs': runs[2:]}):
            self.assertIsNone(collector.deployment('backend')['latestPush'])

    def test_email_has_readable_multipart_summary_and_escaped_commit(self):
        snapshot = {
            'checkedAt': '2026-09-10T10:46:12Z',
            'services': {'frontend': {'status': 'up', 'version': 'online-release'},
                         'backend': {'status': 'up'}, 'database': {'status': 'up'}},
            'deployments': {'backend': {'status': 'failure', 'sha': 'b' * 40,
                'updatedAt': '2026-09-10T10:45:08Z', 'failedStage': 'verify <build>',
                'url': 'https://github.com/Prainn/sunrise-travelops-backend/actions/runs/1',
                'latestPush': {'sha': 'b' * 40, 'message': '<script>alert(1)</script>',
                               'author': 'Joe & Co', 'url': 'https://github.com/Prainn/sunrise-travelops-backend/commit/' + 'b' * 40}}}}
        config = {'STATUS_SMTP_HOST': 'smtp.example.test', 'STATUS_SMTP_FROM': 'status@example.test', 'STATUS_SMTP_TO': 'owner@example.test'}
        with patch.dict(os.environ, config, clear=True), patch.object(smtplib, 'SMTP_SSL') as smtp:
            self.assertEqual(collector.notify(snapshot), 'sent')
        message = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
        self.assertEqual(message.get_content_type(), 'multipart/alternative')
        plain = message.get_body(preferencelist=('plain',)).get_content()
        html = message.get_body(preferencelist=('html',)).get_content()
        for text in ['后端发布：失败', '失败阶段', '2026-09-10 18:46:12', '提交作者', '尚无记录']:
            self.assertIn(text, plain)
            self.assertIn(text, html)
        self.assertNotIn('<script>', html)
        self.assertIn('&lt;script&gt;', html)
        self.assertIn('Joe &amp; Co', html)
        self.assertNotIn('"services":', plain)
        snapshot['deployments']['backend']['status'] = 'running'
        plain, _ = collector.notification_content(snapshot, {'backend-deploy': 'failure'})
        self.assertIn('重试中，等待恢复确认', plain)
        snapshot['deployments']['backend']['status'] = 'success'
        plain, html = collector.notification_content(snapshot, {})
        self.assertIn('服务与发布状态已恢复', plain)
        self.assertIn('发布告警已解除', html)

    def test_github_auth_failure_is_unknown(self):
        with patch.object(collector, 'github', side_effect=ValueError('403')):
            self.assertEqual(collector.deployment('backend')['status'], 'unknown')

    def test_actions_cache_limits_requests_and_expires(self):
        with patch.object(collector, 'deployment', return_value={'status': 'success'}) as probe, patch.object(collector.time, 'time', return_value=1000):
            self.assertEqual(collector.cached_deployment('backend')['status'], 'success')
            collector.cached_deployment('backend')
            probe.assert_called_once()
        with patch.object(collector, 'deployment', return_value={'status': 'unknown'}) as probe, patch.object(collector.time, 'time', return_value=1301):
            self.assertEqual(collector.cached_deployment('backend')['status'], 'unknown')
            probe.assert_called_once()

    def test_manual_refresh_bypasses_cache_and_preserves_real_query_time(self):
        with patch.object(collector, 'deployment', return_value={'status': 'running'}), patch.object(collector, 'utc_now', return_value='first'):
            collector.cached_deployment('backend')
        with patch.object(collector, 'deployment', return_value={'status': 'success'}) as probe, patch.object(collector, 'utc_now', return_value='second'):
            self.assertEqual(collector.cached_deployment('backend')['checkedAt'], 'first')
            probe.assert_not_called()
            result = collector.cached_deployment('backend', force=True)
            self.assertEqual(result, {'status': 'success', 'checkedAt': 'second'})
            probe.assert_called_once()

    def test_manual_cooldown_is_global_persisted_and_timer_does_not_force(self):
        with patch.object(collector, 'collect', return_value={'checkedAt': 'new'}) as collect, patch.object(collector.time, 'time', return_value=1000):
            self.assertEqual(collector.run_collection(manual=True), {'checkedAt': 'new'})
            collect.assert_called_once_with(force=True)
            with self.assertRaises(collector.RefreshRejected) as caught:
                collector.run_collection(manual=True)
            self.assertEqual((caught.exception.status, caught.exception.retry_after), (429, 60))
            collector.run_collection()
            collect.assert_called_with(force=False)
        with patch.object(collector, 'collect') as collect, patch.object(collector.time, 'time', return_value=1061):
            collector.run_collection(manual=True)
            collect.assert_called_once_with(force=True)

    def test_timer_and_manual_collection_cannot_write_concurrently(self):
        with (self.base / 'collection.lock').open('a') as lock, patch.object(collector, 'collect') as collect:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(collector.RefreshRejected) as caught:
                collector.run_collection(manual=True)
            self.assertEqual(caught.exception.status, 409)
            collect.assert_not_called()

    def test_anonymous_budget_is_shared_by_automatic_and_forced_requests(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(collector.time, 'time', return_value=4000):
            collector.save(self.base / 'github-budget.json', {'requests': [1000] * 48}, 0o600)
            with patch.object(collector, 'fetch') as fetch:
                with self.assertRaises(ValueError):
                    collector.github('repo/actions')
                fetch.assert_not_called()
            with self.assertRaises(collector.RefreshRejected) as caught:
                collector.run_collection(manual=True)
            self.assertEqual((caught.exception.error, caught.exception.retry_after), ('github_budget_exhausted', 600))
        with patch.dict(os.environ, {}, clear=True), patch.object(collector.time, 'time', return_value=4601), patch.object(collector, 'fetch', return_value=(200, b'{}')):
            self.assertEqual(collector.github('repo/actions'), {})
            self.assertEqual(len(collector.github_requests()), 1)

    def test_service_probe_gets_its_own_completion_time(self):
        with patch.object(collector, 'utc_now', return_value='completed'):
            self.assertEqual(collector.probe_service(lambda: {'status': 'up'}), {'status': 'up', 'checkedAt': 'completed'})

    def test_refresh_http_contract(self):
        server = HTTPServer(('127.0.0.1', 0), collector.RefreshHandler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)

        def request(method='POST', path='/refresh', headers=None, body=None):
            client = http.client.HTTPConnection(*server.server_address, timeout=3)
            try:
                client.request(method, path, body=body, headers=headers or {})
                response = client.getresponse()
                return response.status, dict(response.getheaders()), json.loads(response.read())
            finally:
                client.close()

        headers = {'X-Status-Refresh': '1', 'Origin': 'https://status.sunrisevacation.cn'}
        with patch.object(collector, 'run_collection', return_value={'checkedAt': 'fresh'}) as run:
            self.assertEqual(request()[0], 403)
            self.assertEqual(request(headers={**headers, 'Origin': 'https://evil.test'})[0], 403)
            self.assertEqual(request(headers=headers, body='x')[0], 400)
            self.assertEqual(request(path='/anything', headers=headers)[0], 404)
            self.assertEqual(request(method='GET')[0], 405)
            run.assert_not_called()
            code, response_headers, payload = request(headers=headers)
            self.assertEqual((code, payload), (200, {'checkedAt': 'fresh'}))
            self.assertEqual(response_headers['Cache-Control'], 'no-store')
            run.assert_called_once_with(manual=True)
        with patch.object(collector, 'run_collection', side_effect=collector.RefreshRejected(429, 'refresh_cooldown', 42)):
            code, response_headers, payload = request(headers=headers)
            self.assertEqual((code, response_headers['Retry-After'], payload['error']), (429, '42', 'refresh_cooldown'))
        with patch.object(collector, 'run_collection', side_effect=RuntimeError('private details')):
            self.assertEqual(request(headers=headers)[2], {'error': 'collection_failed'})

    def test_collection_publishes_forced_results_with_separate_timestamps(self):
        public = self.base / 'public'
        with patch.object(collector, 'PUBLIC', public), patch.object(collector, 'frontend', return_value={'status': 'up'}), patch.object(collector, 'backend', return_value={'status': 'up'}), patch.object(collector, 'database', return_value={'status': 'up'}), patch.object(collector, 'deployment', side_effect=lambda _service: {'status': 'running'}), patch.object(collector, 'notify', return_value='unconfigured'):
            first = collector.run_collection()
            with patch.object(collector, 'deployment', side_effect=lambda _service: {'status': 'success'}):
                cached = collector.run_collection()
                self.assertEqual(cached['deployments']['backend'], first['deployments']['backend'])
                fresh = collector.run_collection(manual=True)
            self.assertEqual(fresh['deployments']['backend']['status'], 'success')
            self.assertNotEqual(fresh['deployments']['backend']['checkedAt'], first['deployments']['backend']['checkedAt'])
            self.assertIn('checkedAt', fresh['services']['database'])
            self.assertEqual(collector.read_json(public / 'status.json'), fresh)

    def test_notifications_require_configuration_and_retry_failed_delivery(self):
        snapshot = {'services': {'backend': {'status': 'down'}}, 'deployments': {}}
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(collector.notify(snapshot), 'unconfigured')
        config = {'STATUS_SMTP_HOST': 'smtp.example.test', 'STATUS_SMTP_FROM': 'status@example.test', 'STATUS_SMTP_TO': 'owner@example.test'}
        with patch.dict(os.environ, config, clear=True), patch.object(smtplib, 'SMTP_SSL', side_effect=OSError('timeout')):
            self.assertEqual(collector.notify(snapshot), 'failed')
        self.assertFalse((self.base / 'notifications.json').exists())
        smtp = MagicMock()
        with patch.dict(os.environ, config, clear=True), patch.object(smtplib, 'SMTP_SSL', return_value=smtp):
            self.assertEqual(collector.notify(snapshot), 'sent')
            self.assertEqual(collector.notify(snapshot), 'ready')
            snapshot['services']['backend']['status'] = 'up'
            self.assertEqual(collector.notify(snapshot), 'sent')
        self.assertEqual(smtp.__enter__().send_message.call_count, 2)

    def test_running_retry_does_not_claim_failure_recovered(self):
        collector.save(self.base / 'notifications.json', {'incidents': {'backend-deploy': 'failure:run:time'}}, 0o600)
        config = {'STATUS_SMTP_HOST': 'smtp.example.test', 'STATUS_SMTP_FROM': 'status@example.test', 'STATUS_SMTP_TO': 'owner@example.test'}
        with patch.dict(os.environ, config, clear=True), patch.object(smtplib, 'SMTP_SSL') as smtp:
            self.assertEqual(collector.notify({'services': {}, 'deployments': {'backend': {'status': 'running'}}}), 'ready')
        smtp.assert_not_called()


if __name__ == '__main__':
    unittest.main()
