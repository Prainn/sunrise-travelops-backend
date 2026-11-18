#!/usr/bin/python3
"""New dev host. Only accept release operations from the pinned old builder."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import socket
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path('/usr/local/libexec/sunrise-dev-release')
CONFIG = Path('/etc/sunrise-dev-release')
DEPLOY_ID = re.compile(r'[a-f0-9]{40}-[0-9]+-[0-9]+')
RETAINED_ID = re.compile(r'(?:[a-f0-9]{40}-[0-9]+-[0-9]+|bootstrap-[0-9]{14})')
IMAGE = re.compile(r'sha256:[a-f0-9]{64}')
MIGRATION = re.compile(r'[A-Za-z][A-Za-z0-9]*[0-9]{13}')


def status(mod, component):
    if component == 'backend':
        state = mod.read_state()
        record = mod.release(state['current'])
        fmt = '{{.Image}} {{.State.Health.Status}}'
        live = mod.run(['docker', 'inspect', mod.API_CONTAINER, '--format', fmt])
        if record['status'] != 'verified' or live != record['image'] + ' healthy':
            raise ValueError('Target image/health differs from verified release')
        return {'current': state['current'], 'previous': state['previous'], 'image': record['image']}
    state = json.loads((mod.BASE / 'last-deployment.json').read_text())
    directory = (mod.BASE / 'current').resolve(strict=True)
    if directory.parent != (mod.BASE / 'releases').resolve() or not state['verified'] or state['release'] != directory.name:
        raise ValueError('Target frontend state differs from current directory')
    marker = json.loads(mod.fetch('/__deploy.json'))
    if marker['release'] != directory.name:
        raise ValueError('Served release differs from target state')
    return {'current': directory.name, 'previous': Path(state['previous']).name if state.get('previous') else None}


def archived_input(limit):
    file = tempfile.TemporaryFile()
    size = 0
    while chunk := sys.stdin.buffer.read(1024 * 1024):
        size += len(chunk)
        if size > limit:
            file.close()
            raise ValueError('Artifact exceeds maximum size')
        file.write(chunk)
    file.seek(0)
    return file


def load_image(image):
    with archived_input(1024 * 1024 * 1024) as archive:
        with tarfile.open(fileobj=archive, mode='r:') as bundle:
            manifest = json.load(bundle.extractfile('manifest.json'))
            if len(manifest) != 1 or manifest[0].get('RepoTags'):
                raise ValueError('Expected one image without mutable tags')
            config = bundle.extractfile(manifest[0]['Config']).read()
            if 'sha256:' + hashlib.sha256(config).hexdigest() != image:
                raise ValueError('Docker archive image ID mismatch')
        archive.seek(0)
        subprocess.run(['docker', 'image', 'load', '--quiet'], stdin=archive, stdout=subprocess.DEVNULL,
                       check=True, timeout=150)
    actual = subprocess.check_output(['docker', 'image', 'inspect', image, '--format', '{{.Id}}'], text=True).strip()
    if actual != image:
        raise ValueError('Loaded image ID mismatch')
    return {'image': image}


def frontend(mod, args, stream_hash):
    if not stream_hash:
        sys.argv = ['deploy.py', *args]
        return mod.main()
    with archived_input(160 * 1024 * 1024) as archive, tempfile.TemporaryDirectory() as temp:
        if hashlib.file_digest(archive, 'sha256').hexdigest() != stream_hash:
            raise ValueError('Frontend archive digest mismatch')
        archive.seek(0)
        with tarfile.open(fileobj=archive, mode='r:gz') as bundle:
            size = 0
            for item in bundle:
                path = PurePosixPath(item.name)
                size += item.size
                if not (item.isfile() or item.isdir()) or path.is_absolute() or '..' in path.parts or size > 512*1024*1024:
                    raise ValueError('Invalid frontend archive member')
                bundle.extract(item, temp, filter='data')
        sys.argv = ['deploy.py', *args, temp]
        return mod.main()


def migrations(value):
    if value != '-' and not all(MIGRATION.fullmatch(name) for name in value.split(',')):
        raise ValueError('Invalid migration review')
    os.environ['REVIEWED_MIGRATIONS'] = '' if value == '-' else value


def main():
    if socket.gethostname() != 'iZbp1j5n14ce3c01o1539cZ' or os.geteuid() == 0:
        raise RuntimeError('Unexpected activation host or account')
    component, op, *args = os.environ.get('SSH_ORIGINAL_COMMAND', '').split()
    if component not in ('frontend', 'backend'):
        raise ValueError('Unknown component')
    scope = (CONFIG / 'scope').read_text().strip()
    if scope not in ('rehearsal', 'live'):
        raise ValueError('Activation scope is closed')
    os.umask(0o077)
    os.environ.update(DEPLOY_ENV='dev', SUNRISE_DEV_REMOTE='0', SUNRISE_ACTIVATION_SCOPE=scope, SUNRISE_LOCK_HELD='1')
    lock = open('/opt/sunrise-ci/build.lock', 'r+')
    fcntl.flock(lock, fcntl.LOCK_EX)
    spec = importlib.util.spec_from_file_location('target_driver', ROOT / (component + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if op == 'status' and not args:
        return status(mod, component)
    if op == 'preflight' and not args and component == 'backend':
        mod.preflight()
        return status(mod, component)
    if component == 'backend':
        if op in ('load', 'has-image') and len(args) == 1 and IMAGE.fullmatch(args[0]):
            if op == 'load':
                return load_image(args[0])
            result = subprocess.run(['docker', 'image', 'inspect', args[0], '--format', '{{.Id}}'],
                                    capture_output=True, text=True)
            if result.returncode and 'No such image' not in result.stderr and 'No such object' not in result.stderr:
                raise RuntimeError('Cannot inspect target Docker image store')
            return result.returncode == 0 and result.stdout.strip() == args[0]
        if op == 'review' and len(args) == 1:
            migrations(args[0])
            manifest = json.loads(sys.stdin.buffer.read(131073))
            if not isinstance(manifest, dict) or not manifest or not all(
                    MIGRATION.fullmatch(k) and isinstance(v, str) and re.fullmatch(r'[0-9a-f]{64}', v)
                    for k, v in manifest.items()):
                raise ValueError('Invalid migration manifest')
            try:
                return mod.review_migrations(manifest)
            except mod.MigrationRequired as error:
                print(str(error), file=sys.stderr)
                raise SystemExit(78)
    if op == 'rollback' and len(args) == 2 and RETAINED_ID.fullmatch(args[0]):
        command, previous, digest = [op, args[0]], args[-1], None
    elif op == 'deploy' and args and DEPLOY_ID.fullmatch(args[0]):
        if component == 'backend' and len(args) == 4 and IMAGE.fullmatch(args[1]):
            migrations(args[2])
            command, previous, digest = [op, args[0], args[1]], args[-1], None
        elif component == 'frontend' and len(args) == 3 and re.fullmatch(r'[0-9a-f]{64}', args[1]):
            command, previous, digest = [op, args[0]], args[-1], args[1]
        else:
            raise ValueError('Unexpected artifact identity')
    else:
        raise ValueError('Unknown release operation')
    active = status(mod, component)
    if previous != active['current']:
        raise ValueError('Target changed before activation')
    if active['current'] == args[0]:
        if component == 'backend' and op == 'deploy' and active['image'] != args[1]:
            raise ValueError('Release already active with another image')
        return {'release': args[0], 'verified': True}
    if component == 'frontend':
        return frontend(mod, command, digest)
    sys.argv = ['deploy.py', *command]
    raise SystemExit(mod.cli())


if __name__ == '__main__':
    result = main()
    if result is not None:
        print(json.dumps(result))
