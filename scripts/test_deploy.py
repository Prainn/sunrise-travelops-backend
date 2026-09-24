"""Release safety checks: no network, Docker daemon or business database access."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('deploy.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseSafety(unittest.TestCase):
    def test_reject_changed_executed_migration(self):
        with self.assertRaisesRegex(ValueError, 'Previously executed'):
            release.check_schema({'A': 'new'}, {'A': 'old'}, ['A'], [])

    def test_pending_requires_review(self):
        with self.assertRaisesRegex(ValueError, 'Pending migrations'):
            release.check_schema({'A': '1', 'B': '2'}, {'A': '1'}, ['A'], [])

    def test_destructive_migration_cannot_be_approved_as_compatible(self):
        name = next(iter(release.BREAKING_MIGRATIONS))
        with self.assertRaisesRegex(ValueError, 'Destructive migration'):
            release.check_schema({name: '1'}, {}, [], [], True)
        with self.assertRaisesRegex(ValueError, 'destructive migration'):
            release.check_schema({}, {name: '1'}, [name], [name])

    def test_failed_activation_restores_previous_image(self):
        with patch.object(release, 'activate', side_effect=[RuntimeError('unhealthy'), None]) as activate:
            with self.assertRaisesRegex(RuntimeError, 'previous application restored'):
                release.activate_or_restore('candidate', 'previous')
            self.assertEqual([c.args[0] for c in activate.call_args_list], ['candidate', 'previous'])

    def test_no_migration_release_does_not_run_backup_or_migrate(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / 'releases').mkdir()
            current = {'current': 'old', 'previous': None, 'migration_history': {'A': '1'}, 'compatible_migrations': []}
            with patch.object(release, 'STATE', state), patch.object(release, 'read_state', return_value=current), \
                 patch.object(release, 'release', return_value={'image': 'old-image'}), \
                 patch.object(release, 'migrations', return_value={'A': '1'}), \
                 patch.object(release, 'applied', return_value=['A']), patch.object(release, 'run') as run, \
                 patch.object(release, 'activate_or_restore'), patch.object(release, 'cleanup_after_success'):
                result = release.publish('a' * 40 + '-1-1', 'new-image')
                self.assertTrue(result['verified'])
                run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
