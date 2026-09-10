import importlib.util
import json
import os
from pathlib import Path
import smtplib
import subprocess
import tempfile
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
