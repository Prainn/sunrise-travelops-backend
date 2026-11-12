#!/usr/bin/python3
"""Prepare/reuse a verified build under the existing cross-repository release lock."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
import urllib.request

import deploy


def build(command):
    # Inherit output: Docker build output contains no server.env or database rows.
    subprocess.run(command, check=True, timeout=1800, pass_fds=(9,))


def identity(source, source_sha, workflow_sha, operation):
    if not all(re.fullmatch(r'[0-9a-f]{40}', value) for value in (source_sha, workflow_sha)):
        raise ValueError('Expected exact source and workflow commit identities')
    if operation not in ('deploy', 'refresh-runtime'):
        raise ValueError('Unsupported candidate operation')
    # Cover all current Docker COPY inputs, including tests used by verify:release.
    inputs = ['Dockerfile', '.dockerignore', 'package.json', 'pnpm-lock.yaml',
              'pnpm-workspace.yaml', 'nest-cli.json', 'tsconfig.json',
              'tsconfig.build.json', 'eslint.config.mjs', '.prettierrc',
              'scripts/check-migration-names.mjs', 'src', 'test']
    digest = hashlib.sha256()
    for item in inputs:
        path = source / item
        paths = sorted(path.rglob('*')) if path.is_dir() else [path]
        for file in paths:
            if file.is_symlink():
                raise ValueError('Build input must not be a symlink: ' + str(file))
            if file.is_dir():
                continue
            digest.update(str(file.relative_to(source)).encode() + b'\0')
            digest.update(hashlib.sha256(file.read_bytes()).digest())
    return {'schema': 1, 'environment': deploy.ENVIRONMENT, 'source_sha': source_sha,
            'workflow_sha': workflow_sha, 'operation': operation, 'inputs': digest.hexdigest()}


def validate_manifest(value):
    if not isinstance(value, dict) or not value or any(
        not re.fullmatch(r'[A-Za-z][A-Za-z0-9]*[0-9]{13}', name) or
        not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest)
        for name, digest in value.items()
    ):
        raise ValueError('Invalid compiled migration manifest')
    return value


def inspect_image(image):
    result = subprocess.run(['docker', 'image', 'inspect', image], capture_output=True,
                            text=True, timeout=30)
    if result.returncode:
        # Only a missing image permits a rebuild; daemon/permission failures do not.
        if 'No such image:' in result.stderr:
            return None
        raise RuntimeError('Cannot inspect candidate image: ' + deploy.public_diagnostic(result.stderr))
    return json.loads(result.stdout)[0]


def verify_image(info, source_sha, key):
    labels = info['Config'].get('Labels', {})
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', info['Id']):
        raise ValueError('Candidate image must have an immutable Docker ID')
    if labels.get('org.opencontainers.image.revision') != source_sha or labels.get('sunrise.build-inputs') != key:
        raise ValueError('Candidate image identity does not match build inputs')


def current_branch():
    request = urllib.request.Request(
        'https://api.github.com/repos/' + os.environ['GITHUB_REPOSITORY'] +
        '/commits/' + os.environ['GITHUB_REF_NAME'],
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN']})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)['sha']


def check_branch(workflow_sha):
    if current_branch() != workflow_sha:
        raise ValueError('Branch advanced; rerun its current commit')


def review(record, path):
    try:
        with deploy.timed('Migration precheck'):
            deploy.review_migrations(record['migrations'])
    except deploy.MigrationRequired:
        record.setdefault('review_wait_started_at', deploy.now())
        deploy.save(path, record)
        raise
    if record.get('review_wait_started_at'):
        started = datetime.fromisoformat(record.pop('review_wait_started_at'))
        elapsed = (datetime.now(timezone.utc) - started).total_seconds()
        deploy.report_result('notice', 'Migration review resumed',
                             f'{elapsed:.3f}s since first wait (includes scheduling/operator time)')
        deploy.save(path, record)


def prepare(source, source_sha, workflow_sha, operation, release_id):
    if os.environ.get('SUNRISE_LOCK_HELD') != '1':
        raise ValueError('Candidate preparation requires the workflow build lock')
    if not deploy.ID.fullmatch(release_id) or not release_id.startswith(source_sha + '-'):
        raise ValueError('Release ID does not match source')
    verified_dev_sha = os.environ.get('HOSTED_VERIFIED_DEV_SHA', '')
    if verified_dev_sha and not (
        deploy.ENVIRONMENT == 'dev' and operation == 'deploy' and verified_dev_sha == source_sha == workflow_sha
    ):
        raise ValueError('Hosted verification must match the exact ordinary dev candidate')
    check_branch(workflow_sha)
    binding = identity(source, source_sha, workflow_sha, operation)
    key = hashlib.sha256(json.dumps(binding, sort_keys=True).encode()).hexdigest()
    directory = deploy.STATE / 'candidates'
    directory.mkdir(exist_ok=True, mode=0o700)
    path = directory / (key + '.json')
    record = json.loads(path.read_text()) if path.exists() else None
    if record is not None and (record.get('binding') != binding or record.get('status') not in ('manifest_ready', 'built')):
        raise ValueError('Candidate record does not match build inputs')
    if record is None:
        with deploy.timed('Compile migration manifest'):
            with tempfile.TemporaryDirectory(prefix='sunrise-migrations-') as output:
                build(['docker', 'buildx', 'build', '--builder', 'sunrise', '--target',
                       'migration-manifest', '--output', 'type=local,dest=' + output, '.'])
                manifest = validate_manifest(json.loads((Path(output) / 'migration-manifest.json').read_text()))
        record = {'binding': binding, 'status': 'manifest_ready', 'migrations': manifest}
        deploy.save(path, record)
    validate_manifest(record['migrations'])
    # No full application build is allowed before exact migration review.
    review(record, path)
    image = None
    if record['status'] == 'built':
        with deploy.timed('Verify reusable candidate'):
            if not deploy.ID.fullmatch(record.get('build_release', '')) or not record['build_release'].startswith(source_sha + '-'):
                raise ValueError('Candidate has no successful build run identity')
            if not re.fullmatch(r'sha256:[0-9a-f]{64}', record.get('image', '')):
                raise ValueError('Candidate record must bind an immutable image')
            info = inspect_image(record['image'])
            if info is not None:
                verify_image(info, source_sha, key)
                if info['Id'] != record['image'] or deploy.migrations(info['Id']) != record['migrations']:
                    raise ValueError('Reusable candidate migration/image identity changed')
                image = info['Id']
                deploy.report_result('notice', 'Reusing verified candidate',
                                     f"Build {record['build_release']}; image {image}")
    if image is None:
        with deploy.timed('Build and verify application image'):
            tag = 'sunrise-travelops-api:candidate-' + key
            # Hosted verification changes where lint runs; both paths compile identical inputs.
            checks = ['--build-arg', 'SUNRISE_BUILD_CHECKS=hosted-dev'] if verified_dev_sha else []
            build(['docker', 'buildx', 'build', '--builder', 'sunrise', '--load',
                   *checks,
                   '--label', 'org.opencontainers.image.revision=' + source_sha,
                   '--label', 'sunrise.build-inputs=' + key, '-t', tag, '.'])
            info = inspect_image(tag)
            if info is None:
                raise ValueError('Built candidate image is missing')
            verify_image(info, source_sha, key)
            if deploy.migrations(info['Id']) != record['migrations']:
                raise ValueError('Final image migrations differ from the prechecked compiled manifest')
            image = info['Id']
            record.update(status='built', image=image, build_release=release_id, built_at=deploy.now())
            deploy.save(path, record)
    # Do not deploy a stale branch or trust a DB snapshot taken before the build.
    check_branch(workflow_sha)
    review(record, path)
    return image


def main():
    os.umask(0o077)
    try:
        source_sha, workflow_sha, operation, release_id = sys.argv[1:]
        image = prepare(Path.cwd(), source_sha, workflow_sha, operation, release_id)
        # Always use the current workflow's gateway, also for runtime-only refresh.
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('deploy.py')),
                                 'deploy', release_id, image], check=False, pass_fds=(9,))
        return result.returncode
    except deploy.MigrationRequired as error:
        deploy.report_result('warning', 'Waiting for migration - NOT deployed', error)
        return 78
    except Exception as error:
        deploy.report_result('error', 'Backend preparation failed', error)
        return 1


if __name__ == '__main__':
    sys.exit(main())
