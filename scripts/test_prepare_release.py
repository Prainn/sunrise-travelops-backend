"""Offline release orchestration tests; all Docker, network and DB boundaries mocked."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import prepare_release as candidate

SHA = 'a' * 40
WORKFLOW = 'b' * 40
IMAGE = 'sha256:' + 'c' * 64
OLD = 'Old1700000000000'
NEW = 'New1700000000001'
MANIFEST = {OLD: '1' * 64, NEW: '2' * 64}


class CandidateSafety(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state = self.root / 'state'
        self.state.mkdir()
        self.binding = {'schema': 1, 'environment': 'dev', 'source_sha': SHA,
                        'workflow_sha': WORKFLOW, 'operation': 'deploy', 'inputs': 'source-inputs'}
        self.database = [OLD]
        self.current = {'migration_history': {OLD: '1' * 64}, 'compatible_migrations': []}
        self.image = None
        self.builds = []
        self.app_manifest = MANIFEST.copy()
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.dict(os.environ, {'SUNRISE_LOCK_HELD': '1', 'REVIEWED_MIGRATIONS': NEW,
                                                  'HOSTED_VERIFIED_DEV_SHA': '',
                                                  'GITHUB_STEP_SUMMARY': str(self.root / 'summary')}))
        stack.enter_context(patch.object(candidate.deploy, 'STATE', self.state))
        stack.enter_context(patch.object(candidate.deploy, 'read_state', side_effect=lambda: self.current))
        stack.enter_context(patch.object(candidate.deploy, 'applied', side_effect=lambda: list(self.database)))
        stack.enter_context(patch.object(candidate, 'identity', side_effect=lambda *args: self.binding.copy()))
        self.branch = stack.enter_context(patch.object(candidate, 'current_branch', return_value=WORKFLOW))
        stack.enter_context(patch.object(candidate, 'build', side_effect=self.build))
        stack.enter_context(patch.object(candidate, 'inspect_image', side_effect=lambda image: self.image))
        stack.enter_context(patch.object(candidate.deploy, 'migrations', side_effect=lambda image: self.app_manifest.copy()))
        stack.enter_context(contextlib.redirect_stderr(io.StringIO()))

    def build(self, command):
        self.builds.append(command)
        if '--target' in command:
            output = command[command.index('--output') + 1].split('dest=', 1)[1]
            (Path(output) / 'migration-manifest.json').write_text(json.dumps(MANIFEST))
        else:
            key = next(value.split('=', 1)[1] for value in command if value.startswith('sunrise.build-inputs='))
            self.image = {'Id': IMAGE, 'Config': {'Labels': {
                'org.opencontainers.image.revision': SHA, 'sunrise.build-inputs': key}}}

    def prepare(self, attempt=1):
        return candidate.prepare(self.root, SHA, WORKFLOW, 'deploy', SHA + '-100-' + str(attempt))

    def record(self):
        path = next((self.state / 'candidates').glob('*.json'))
        return path, json.loads(path.read_text())

    def test_unreviewed_migration_stops_before_full_image_build(self):
        with patch.dict(os.environ, {'REVIEWED_MIGRATIONS': ''}):
            with self.assertRaises(candidate.deploy.MigrationRequired):
                self.prepare()
        self.assertEqual(len(self.builds), 1)
        self.assertIn('--target', self.builds[0])
        self.assertEqual(self.record()[1]['status'], 'manifest_ready')
        self.assertIn('review_wait_started_at', self.record()[1])
        self.assertIn('waiting_migration', (self.root / 'summary').read_text())

    def test_exact_review_resumes_precheck_and_builds_once(self):
        self.test_unreviewed_migration_stops_before_full_image_build()
        self.assertEqual(self.prepare(2), IMAGE)
        self.assertEqual(len(self.builds), 2)
        self.assertEqual(self.record()[1]['status'], 'built')
        self.assertIn('Migration review resumed', (self.root / 'summary').read_text())

    def test_verified_candidate_reuses_immutable_image_without_any_buildx(self):
        self.prepare()
        self.builds.clear()
        self.assertEqual(self.prepare(2), IMAGE)
        self.assertEqual(self.builds, [])
        self.assertIn('Reusing verified candidate', (self.root / 'summary').read_text())

    def test_missing_image_rebuilds_and_reverifies(self):
        self.prepare()
        self.image = None
        self.builds.clear()
        self.assertEqual(self.prepare(2), IMAGE)
        self.assertEqual(len(self.builds), 1)
        self.assertIn('--load', self.builds[0])
        self.assertNotIn('--build-arg', self.builds[0])

    def test_exact_hosted_dev_candidate_compiles_without_repeating_lint(self):
        self.branch.return_value = SHA
        with patch.object(candidate.deploy, 'ENVIRONMENT', 'dev'), \
             patch.dict(os.environ, {'HOSTED_VERIFIED_DEV_SHA': SHA}):
            self.assertEqual(candidate.prepare(self.root, SHA, SHA, 'deploy', SHA + '-100-1'), IMAGE)
        manifest, application = self.builds
        self.assertNotIn('--build-arg', manifest)
        self.assertEqual(application[application.index('--build-arg') + 1], 'SUNRISE_BUILD_CHECKS=hosted-dev')

    def test_hosted_verification_cannot_be_used_for_other_commits_or_paths(self):
        for environment, operation, workflow_sha, verified_sha in (
            ('dev', 'deploy', WORKFLOW, SHA),
            ('dev', 'deploy', SHA, WORKFLOW),
            ('prod', 'deploy', SHA, SHA),
            ('dev', 'refresh-runtime', SHA, SHA),
        ):
            with self.subTest(environment=environment, operation=operation, workflow_sha=workflow_sha), \
                 patch.object(candidate.deploy, 'ENVIRONMENT', environment), \
                 patch.dict(os.environ, {'HOSTED_VERIFIED_DEV_SHA': verified_sha}):
                with self.assertRaisesRegex(ValueError, 'exact ordinary dev candidate'):
                    candidate.prepare(self.root, SHA, workflow_sha, operation, SHA + '-100-1')
        self.assertEqual(self.builds, [])

    def test_wrong_image_identity_rejected_without_rebuild(self):
        self.prepare()
        self.image['Id'] = 'sha256:' + 'd' * 64
        self.builds.clear()
        with self.assertRaisesRegex(ValueError, 'identity changed'):
            self.prepare(2)
        self.assertEqual(self.builds, [])

    def test_reused_image_migration_mismatch_rejected(self):
        self.prepare()
        self.app_manifest[OLD] = '9' * 64
        with self.assertRaisesRegex(ValueError, 'identity changed'):
            self.prepare(2)

    def test_full_build_manifest_must_match_precheck(self):
        self.app_manifest[NEW] = '9' * 64
        with self.assertRaisesRegex(ValueError, 'Final image migrations differ'):
            self.prepare()
        self.assertEqual(self.record()[1]['status'], 'manifest_ready')

    def test_full_build_failure_never_creates_reusable_evidence(self):
        real_build = self.build
        def fail(command):
            if '--load' in command:
                raise subprocess.CalledProcessError(1, command)
            real_build(command)
        with patch.object(candidate, 'build', side_effect=fail):
            with self.assertRaises(subprocess.CalledProcessError):
                self.prepare()
        self.assertEqual(self.record()[1]['status'], 'manifest_ready')
        self.assertIn('failed', (self.root / 'summary').read_text())

    def test_branch_advance_rejects_before_build(self):
        self.branch.return_value = 'f' * 40
        with self.assertRaisesRegex(ValueError, 'Branch advanced'):
            self.prepare()
        self.assertEqual(self.builds, [])

    def test_branch_advance_after_build_preserves_candidate_but_rejects_release(self):
        self.branch.side_effect = [WORKFLOW, 'f' * 40]
        with self.assertRaisesRegex(ValueError, 'Branch advanced'):
            self.prepare()
        self.assertEqual(self.record()[1]['status'], 'built')

    def test_database_change_requires_new_exact_review_even_when_candidate_exists(self):
        self.prepare()
        self.database.append(NEW)
        self.builds.clear()
        with self.assertRaises(candidate.deploy.MigrationRequired):
            self.prepare(2)
        self.assertEqual(self.builds, [])
        with patch.dict(os.environ, {'REVIEWED_MIGRATIONS': ''}):
            self.assertEqual(self.prepare(3), IMAGE)

    def test_database_change_during_build_waits_with_reusable_candidate(self):
        def branch():
            if self.image is not None:
                self.database.append(NEW)
            return WORKFLOW
        self.branch.side_effect = branch
        with self.assertRaises(candidate.deploy.MigrationRequired):
            self.prepare()
        self.assertEqual(self.record()[1]['status'], 'built')

    def test_changed_executed_migration_rejected_before_full_build(self):
        self.current['migration_history'][OLD] = '9' * 64
        with self.assertRaisesRegex(ValueError, 'Previously executed migration changed'):
            self.prepare()
        self.assertEqual(len(self.builds), 1)

    def test_breaking_migration_cannot_be_approved(self):
        with patch.object(candidate.deploy, 'BREAKING_MIGRATIONS', {NEW}):
            with self.assertRaisesRegex(candidate.deploy.MigrationRequired, 'separate maintenance plan'):
                self.prepare()
        self.assertEqual(len(self.builds), 1)

    def test_no_migration_release_needs_no_approval(self):
        self.database.append(NEW)
        with patch.dict(os.environ, {'REVIEWED_MIGRATIONS': ''}):
            self.assertEqual(self.prepare(), IMAGE)

    def test_environment_inputs_and_runtime_patch_do_not_reuse_old_candidate(self):
        self.prepare()
        for field in ('environment', 'inputs', 'workflow_sha', 'operation'):
            self.binding[field] += '-changed'
            self.builds.clear()
            self.prepare(2)
            self.assertEqual(len(self.builds), 2, field)

    def test_missing_build_evidence_rejected(self):
        self.prepare()
        path, record = self.record()
        del record['build_release']
        path.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, 'successful build run identity'):
            self.prepare(2)

    def test_requires_shared_lock(self):
        with patch.dict(os.environ, {'SUNRISE_LOCK_HELD': '0'}):
            with self.assertRaisesRegex(ValueError, 'build lock'):
                self.prepare()
        self.assertEqual(self.builds, [])


class InspectImage(unittest.TestCase):
    def test_missing_image_is_rebuildable_but_daemon_failure_is_not(self):
        for stderr, missing in [('Error response from daemon: No such image: sha256:a', True),
                                ('Cannot connect to the Docker daemon', False)]:
            with patch.object(candidate.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', stderr)):
                if missing:
                    self.assertIsNone(candidate.inspect_image(IMAGE))
                else:
                    with self.assertRaises(RuntimeError):
                        candidate.inspect_image(IMAGE)

    def test_build_process_inherits_release_lock_descriptor(self):
        # Real subprocesses, no Docker: close_fds must not drop the shared lock.
        code = '''
import os, sys, tempfile
sys.path.insert(0, sys.argv[1])
import prepare_release
with tempfile.TemporaryFile() as lock:
    os.dup2(lock.fileno(), 9, inheritable=True)
    prepare_release.build([sys.executable, '-c', 'import os; os.fstat(9)'])
'''
        subprocess.run([sys.executable, '-c', code, str(Path(__file__).parent)],
                       check=True, capture_output=True, timeout=10)

    def test_gateway_exit_status_and_lock_survive_orchestration(self):
        for code in (0, 1, 78):
            with patch.object(candidate, 'prepare', return_value=IMAGE), \
                 patch.object(candidate.sys, 'argv', ['prepare_release.py', SHA, WORKFLOW, 'deploy', SHA + '-100-1']), \
                 patch.object(candidate.subprocess, 'run', return_value=subprocess.CompletedProcess([], code)) as run:
                self.assertEqual(candidate.main(), code)
                self.assertEqual(run.call_args.kwargs['pass_fds'], (9,))
                self.assertEqual(run.call_args.args[0][-3:], ['deploy', SHA + '-100-1', IMAGE])

    @patch.object(candidate.deploy, 'ENVIRONMENT', 'dev')
    def test_input_identity_covers_source_toolchain_runtime_and_environment(self):
        # Exercise real input binding, rather than the orchestration fixture's stub.
        source = Path(__file__).resolve().parent.parent
        original = candidate.identity(source, SHA, WORKFLOW, 'deploy')
        with tempfile.TemporaryDirectory() as temporary:
            import shutil
            copy = Path(temporary)
            for name in ['Dockerfile', '.dockerignore', 'package.json', 'pnpm-lock.yaml',
                         'pnpm-workspace.yaml', 'nest-cli.json', 'tsconfig.json',
                         'tsconfig.build.json', 'eslint.config.mjs', '.prettierrc',
                         'scripts/check-migration-names.mjs', 'src', 'test']:
                target = copy / name
                target.parent.mkdir(parents=True, exist_ok=True)
                if (source / name).is_dir():
                    shutil.copytree(source / name, target)
                else:
                    shutil.copyfile(source / name, target)
            self.assertEqual(candidate.identity(copy, SHA, WORKFLOW, 'deploy'), original)
            for name in ['Dockerfile', 'pnpm-lock.yaml', 'tsconfig.json', 'src/main.ts']:
                path = copy / name
                before = path.read_bytes()
                path.write_bytes(before + b'\n')
                self.assertNotEqual(candidate.identity(copy, SHA, WORKFLOW, 'deploy')['inputs'], original['inputs'])
                path.write_bytes(before)
        with patch.object(candidate.deploy, 'ENVIRONMENT', 'prod'):
            self.assertNotEqual(candidate.identity(source, SHA, WORKFLOW, 'deploy'), original)
        self.assertNotEqual(candidate.identity(source, SHA, 'd' * 40, 'refresh-runtime'), original)


if __name__ == '__main__':
    unittest.main()
