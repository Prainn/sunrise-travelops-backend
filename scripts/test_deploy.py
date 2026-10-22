"""Release safety checks: no network, Docker daemon or business database access."""
import importlib.util
import contextlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('deploy.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseSafety(unittest.TestCase):
    def candidate_result(self, state, target, database, reviewed=''):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(release, 'STATE', Path(temporary)), \
                 patch.object(release, 'read_state', return_value=state), \
                 patch.object(release, 'migrations', return_value=target), \
                 patch.object(release, 'applied', return_value=database), \
                 patch.object(release, 'run', return_value=json.dumps([{
                     'Id': 'candidate', 'Config': {'Labels': {'org.opencontainers.image.revision': 'a' * 40}}
                 }])), \
                 patch.object(release, 'publish', return_value={'verified': True}) as publish, \
                 patch.object(release.signal, 'signal'), \
                 patch.object(release.sys, 'argv', ['deploy.py', 'deploy', 'a' * 40 + '-1-1', 'candidate']), \
                 patch.dict(os.environ, {'SUNRISE_LOCK_HELD': '1', 'REVIEWED_MIGRATIONS': reviewed,
                                         'GITHUB_ACTIONS': 'true', 'GITHUB_STEP_SUMMARY': str(Path(temporary) / 'summary')}), \
                 contextlib.redirect_stderr(io.StringIO()) as stderr, contextlib.redirect_stdout(io.StringIO()):
                code = release.cli()
                return code, stderr.getvalue(), publish.call_count

    def test_unreviewed_migration_waits_without_publishing(self):
        state = {'migration_history': {'A': '1'}, 'compatible_migrations': []}
        code, diagnostic, calls = self.candidate_result(state, {'A': '1', 'B': '2'}, ['A'])
        self.assertEqual((code, calls), (78, 0))
        self.assertIn('::warning', diagnostic)
        self.assertIn('NOT deployed', diagnostic)
        self.assertIn('B', diagnostic)
        self.assertNotIn('::error', diagnostic)

    def test_reviewed_compatible_migration_can_publish(self):
        state = {'migration_history': {'A': '1'}, 'compatible_migrations': []}
        code, _, calls = self.candidate_result(state, {'A': '1', 'B': '2'}, ['A'], 'B')
        self.assertEqual((code, calls), (0, 1))

    def test_reviewed_destructive_migration_still_waits_without_publishing(self):
        name = next(iter(release.BREAKING_MIGRATIONS))
        state = {'migration_history': {'A': '1'}, 'compatible_migrations': []}
        code, diagnostic, calls = self.candidate_result(state, {'A': '1', name: '2'}, ['A'], name)
        self.assertEqual((code, calls), (78, 0))
        self.assertIn('separate maintenance plan', diagnostic)
        self.assertIn(name, diagnostic)

    def test_changed_migration_is_failure_even_with_pending_migrations(self):
        state = {'migration_history': {'A': 'old'}, 'compatible_migrations': []}
        code, diagnostic, calls = self.candidate_result(state, {'A': 'new', 'B': '2'}, ['A'])
        self.assertEqual((code, calls), (1, 0))
        self.assertIn('::error', diagnostic)
        self.assertIn('Previously executed migration changed: A', diagnostic)

    def test_command_failure_exposes_permission_reason_not_private_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(release, 'STATE', Path(temporary)), \
                 patch.object(release.subprocess, 'run', return_value=subprocess.CompletedProcess(
                     ['docker'], 1, 'private database rows', 'open /opt/example/server.env: permission denied')):
                with self.assertRaisesRegex(RuntimeError, 'permission denied') as error:
                    release.run(['docker', 'compose', 'exec'])
                self.assertNotIn('private database rows', str(error.exception))
                self.assertIn('exit 1', str(error.exception))

    def test_public_diagnostics_mask_credentials_sql_and_annotations(self):
        with tempfile.TemporaryDirectory() as temporary:
            (Path(temporary) / 'server.env').write_text('DATABASE_PASSWORD=private-pass\n')
            with patch.object(release, 'BASE', Path(temporary)), \
                 patch.dict(os.environ, {'GITHUB_ACTIONS': 'true', 'GITHUB_STEP_SUMMARY': '', 'GH_TOKEN': 'private-token'}), \
                 contextlib.redirect_stderr(io.StringIO()) as stderr:
                release.report_result('error', 'Backend deployment failed',
                                      'private-pass private-token postgres://alice:secret@db\n'
                                      'query: SELECT customer FROM inquiries\nDETAIL: Failing row contains private data\n'
                                      '  continued private data\n\npermission denied\n::notice::forged')
                diagnostic = stderr.getvalue()
                for secret in ['private-pass', 'private-token', 'alice:secret', 'customer', 'private data']:
                    self.assertNotIn(secret, diagnostic)
                self.assertIn('permission denied', diagnostic)
                self.assertNotIn('::notice::forged', diagnostic)
                self.assertIn('%0A: :notice: :forged', diagnostic)

    def test_command_timeout_is_real_failure(self):
        with patch.object(release.subprocess, 'run', side_effect=subprocess.TimeoutExpired(['docker'], 300)):
            with self.assertRaisesRegex(RuntimeError, 'docker compose timed out after 300 seconds'):
                release.run(['docker', 'compose', 'exec'])

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
                 patch.object(release, 'release', return_value={'image': 'old-image', 'migrations': {'A': '1'}}), \
                 patch.object(release, 'migrations', return_value={'A': '1'}), \
                 patch.object(release, 'applied', return_value=['A']), patch.object(release, 'run') as run, \
                 patch.object(release, 'activate_or_restore'), patch.object(release, 'cleanup_after_success'):
                result = release.publish('a' * 40 + '-1-1', 'new-image')
                self.assertTrue(result['verified'])
                run.assert_not_called()

    def test_failed_release_after_maintenance_does_not_restart_incompatible_image(self):
        name = 'UnifyResourceLibrary1791619200000'
        target = {'A': '1', name: '2'}
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / 'releases').mkdir()
            current = {'current': 'old', 'previous': None, 'migration_history': {'A': '1'}, 'compatible_migrations': []}
            with patch.object(release, 'STATE', state), patch.object(release, 'read_state', return_value=current), \
                 patch.object(release, 'release', return_value={'image': 'old-image', 'migrations': {'A': '1'}}), \
                 patch.object(release, 'migrations', return_value=target), \
                 patch.object(release, 'applied', return_value=list(target)), \
                 patch.object(release, 'activate', side_effect=RuntimeError('unhealthy')) as activate, \
                 patch.object(release, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'candidate API stopped'):
                    release.publish('a' * 40 + '-1-1', 'new-image')
                activate.assert_called_once_with('new-image')
                run.assert_called_once_with(release.COMPOSE + ['stop', 'api'])

    def test_first_release_failure_stops_candidate_without_database_changes(self):
        with patch.object(release, 'activate', side_effect=RuntimeError('unhealthy')), \
             patch.object(release, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'candidate API stopped'):
                release.activate_or_restore('candidate', None)
            run.assert_called_once_with(release.COMPOSE + ['stop', 'api'])


if __name__ == '__main__':
    unittest.main()
