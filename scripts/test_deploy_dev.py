import importlib.util
from pathlib import Path
import unittest
from unittest.mock import call, patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy-dev.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
    def test_no_schema_change_can_publish(self):
        self.assertEqual(deploy.check_schema({'A': 'a'}, {'A': 'a'}, ['A'], []), [])

    def test_changed_executed_migration_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Previously executed migration changed'):
            deploy.check_schema({'A': 'changed'}, {'A': 'original'}, ['A'], [])

    def test_pending_migration_requires_confirmation(self):
        with self.assertRaisesRegex(ValueError, 'manual backward-compatibility'):
            deploy.check_schema({'A': 'a', 'B': 'b'}, {'A': 'a'}, ['A'], [])

    def test_confirmed_pending_migration_is_returned(self):
        self.assertEqual(deploy.check_schema({'A': 'a', 'B': 'b'}, {'A': 'a'}, ['A'], [], True), ['B'])

    def test_rollback_refuses_unknown_database_changes(self):
        with self.assertRaisesRegex(ValueError, 'does not support current database'):
            deploy.check_schema({'A': 'a'}, {'A': 'a', 'B': 'b'}, ['A', 'B'], [])

    def test_rollback_allows_only_confirmed_compatible_changes(self):
        self.assertEqual(deploy.check_schema({'A': 'a'}, {'A': 'a', 'B': 'b'}, ['A', 'B'], ['B']), [])

    def test_failed_candidate_restores_previous_image(self):
        with patch.object(deploy, 'activate', side_effect=[RuntimeError('unhealthy'), None]) as activate:
            with self.assertRaisesRegex(RuntimeError, 'previous application restored'):
                deploy.activate_or_restore('new-image', 'old-image')
        self.assertEqual(activate.call_args_list, [call('new-image'), call('old-image')])

    def test_failed_rollback_requires_attention(self):
        with patch.object(deploy, 'activate', side_effect=RuntimeError('unhealthy')):
            with self.assertRaisesRegex(RuntimeError, 'operator attention required'):
                deploy.activate_or_restore('new-image', 'old-image')

    def test_healthy_candidate_does_not_restart_previous(self):
        with patch.object(deploy, 'activate') as activate:
            deploy.activate_or_restore('new-image', 'old-image')
        activate.assert_called_once_with('new-image')


if __name__ == '__main__':
    unittest.main()
