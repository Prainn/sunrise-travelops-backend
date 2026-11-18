#!/usr/bin/python3
"""Old dev builder. Activate immutable artifacts over a short-lived private SSH connection."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

DEPLOY_ID = re.compile(r'[a-f0-9]{40}-[0-9]+-[0-9]+')
IMAGE_ID = re.compile(r'sha256:[a-f0-9]{64}')
SSH = ['ssh', '-T', '-oBatchMode=yes', '-oIdentitiesOnly=yes', '-oStrictHostKeyChecking=yes',
       '-oConnectTimeout=5', '-oServerAliveInterval=10', '-oServerAliveCountMax=3',
       '-oUserKnownHostsFile=/etc/sunrise-dev-release/known_hosts',
       '-i', str(Path.home() / '.ssh/sunrise-dev-release'), 'sunrise-runner@172.29.23.198']


def call(component, *args, stream=None, data=None, timeout=150):
    # OpenSSH passes a command line. Arguments accepted by both ends are single protocol words.
    words = [component, *args]
    if any(not re.fullmatch(r'[A-Za-z0-9_:.,-]+', word) for word in words):
        raise ValueError('Invalid deployment protocol argument')
    result = subprocess.run([*SSH, *words], stdin=stream, input=data, stdout=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise SystemExit(result.returncode)
    return json.loads(result.stdout)


def main():
    component, op, *args = sys.argv[1:]
    if component not in ('frontend', 'backend'):
        raise ValueError('Unknown component')
    reviewed = os.environ.get('REVIEWED_MIGRATIONS') or '-'
    if op in ('preflight', 'status', 'current-sha') and not args:
        state = call(component, 'preflight' if op == 'preflight' else 'status')
        if op == 'current-sha':
            if not DEPLOY_ID.fullmatch(state['current']):
                raise ValueError('Current version has no verified commit')
            print(state['current'].split('-')[0])
            return
        return state
    if component == 'backend' and op == 'review' and not args:
        return call(component, op, reviewed, data=sys.stdin.buffer.read(131073))
    state = call(component, 'status')
    current = state['current']
    if op == 'rollback' and len(args) == 1:
        target = state['previous'] if args[0] == 'previous' else args[0]
        if not target:
            raise ValueError('No previous retained release')
    elif op == 'deploy' and len(args) == 2 and DEPLOY_ID.fullmatch(args[0]):
        target, source = args
    else:
        raise ValueError('Invalid release operation')
    if op == 'deploy' and component == 'backend':
        if not IMAGE_ID.fullmatch(source):
            raise ValueError('Expected immutable build image')
        if not call(component, 'has-image', source):
            with tempfile.TemporaryFile() as archive:
                subprocess.run(['docker', 'image', 'save', source], stdout=archive, check=True, timeout=180)
                archive.seek(0)
                call(component, 'load', source, stream=archive, timeout=240)
        command = [op, target, source, reviewed, current]
    elif op == 'deploy':
        dist = Path(source).resolve(strict=True)
        with tempfile.TemporaryFile() as archive:
            with tarfile.open(fileobj=archive, mode='w:gz', compresslevel=1) as bundle:
                for path in sorted(dist.iterdir()):
                    bundle.add(path, arcname=path.name)
            archive.seek(0)
            checksum = hashlib.sha256()
            for chunk in iter(lambda: archive.read(1024 * 1024), b''):
                checksum.update(chunk)
            digest = checksum.hexdigest()
            archive.seek(0)
            return activate(component, [op, target, digest, current], target, archive)
    else:
        command = [op, target, current]
    return activate(component, command, target)


def activate(component, args, target, archive=None):
    try:
        return call(component, *args, stream=archive, timeout=300)
    except (SystemExit, subprocess.TimeoutExpired) as error:
        # Never repeat a mutation on an uncertain result. The target's status holds its lock
        # and verifies both the recorded artifact and the actual live service.
        if not isinstance(error, subprocess.TimeoutExpired) and error.code != 255:
            raise
        observed = call(component, 'status')
        if observed['current'] != target:
            raise RuntimeError('Activation unconfirmed; target current is ' + observed['current']) from error
        return {'release': target, 'verified': True, 'reconciled': True}


if __name__ == '__main__':
    result = main()
    if result is not None:
        print(json.dumps(result))
