import importlib.util
import json
import io
import os
import tempfile
from pathlib import Path
import unittest
from unittest.mock import call, patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy-dev.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
    def test_cleanup_protects_current_previous_latest_and_all_container_images(self):
        with tempfile.TemporaryDirectory() as directory:
            state_dir = Path(directory)
            (state_dir / 'releases').mkdir()
            names = [f'bootstrap-2026090900000{i}' for i in range(7)]
            for i, name in enumerate(names):
                path = state_dir / 'releases' / (name + '.json')
                path.write_text(json.dumps({'image': f'image-{i}', 'status': 'verified'}))
                os.utime(path, (i + 1, i + 1))
            (state_dir / 'state.json').write_text(json.dumps({'current': names[0], 'previous': names[1]}))
            outputs = ['container', json.dumps([{'Image': 'image-2'}]),
                       'sunrise-travelops-api:old\nsunrise-travelops-api:kept',
                       json.dumps([{'Id': 'image-3', 'RepoTags': ['sunrise-travelops-api:old']},
                                   {'Id': 'image-0', 'RepoTags': ['sunrise-travelops-api:kept']}])]
            with patch.object(deploy, 'STATE', state_dir), patch.object(deploy, 'run', side_effect=outputs):
                plan = deploy.cleanup_plan()
            self.assertEqual(plan['removeRecords'], [names[3]])
            self.assertEqual(plan['removeImageTags'], ['sunrise-travelops-api:old'])
            self.assertIn(names[2], plan['keep'])

    def test_cleanup_only_removes_planned_tags_records_and_old_build_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            state_dir = Path(directory)
            (state_dir / 'releases').mkdir()
            name = 'bootstrap-20260909000000'
            record = state_dir / 'releases' / (name + '.json')
            record.write_text('{}')
            plan = {'removeRecords': [name], 'removeImageTags': ['sunrise-travelops-api:old']}
            with patch.object(deploy, 'STATE', state_dir), patch.object(deploy, 'cleanup_plan', return_value=plan), patch.object(deploy, 'run') as run:
                deploy.cleanup()
            self.assertFalse(record.exists())
            self.assertEqual(run.call_args_list, [call(['docker', 'image', 'rm', 'sunrise-travelops-api:old']),
                call(['docker', 'builder', 'prune', '--all', '--force', '--filter', 'until=168h'])])

    def test_cleanup_failure_warns_without_raising(self):
        with patch.object(deploy, 'cleanup', side_effect=RuntimeError('denied')), patch('sys.stderr', new_callable=io.StringIO) as stderr:
            deploy.cleanup_after_success()
        self.assertIn('::warning::', stderr.getvalue())
    def test_destructive_migration_cannot_use_mistaken_compatibility_flag(self):
        name = 'ReviseTravelPlanning1788912000000'
        with self.assertRaisesRegex(ValueError, 'destructive migration'):
            deploy.check_schema({'A': 'a'}, {'A': 'a', name: 'b'}, ['A', name], [name])
        with self.assertRaisesRegex(ValueError, 'separate maintenance plan'):
            deploy.check_schema({'A': 'a', name: 'b'}, {'A': 'a'}, ['A'], [], True)

    def test_publish_records_time_only_after_verification(self):
        for fails in [False, True]:
            with self.subTest(fails=fails), tempfile.TemporaryDirectory() as directory:
                state_dir = Path(directory)
                (state_dir / 'releases').mkdir()
                old = 'bootstrap-20260909000000'
                new = 'bootstrap-20260910000000'
                state = {'current': old, 'previous': None, 'migration_history': {'A': 'a'},
                         'compatible_migrations': [], 'last_deployed_at': 'old-time'}
                (state_dir / 'state.json').write_text(json.dumps(state))
                (state_dir / 'releases' / (old + '.json')).write_text(json.dumps({'image': 'old-image'}))
                with patch.object(deploy, 'STATE', state_dir), patch.object(deploy, 'migrations', return_value={'A': 'a'}), patch.object(deploy, 'applied', return_value=['A']), patch.object(deploy, 'run', return_value='backup'), patch.object(deploy, 'now', return_value='verified-time'), patch.object(deploy, 'activate_or_restore', side_effect=RuntimeError('failed') if fails else None):
                    if fails:
                        with self.assertRaises(RuntimeError):
                            deploy.publish(new, 'new-image')
                    else:
                        deploy.publish(new, 'new-image')
                after = json.loads((state_dir / 'state.json').read_text())
                self.assertEqual(after['last_deployed_at'], 'old-time' if fails else 'verified-time')
                self.assertEqual(after['current'], old if fails else new)

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
