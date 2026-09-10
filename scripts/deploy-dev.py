#!/usr/bin/python3
"""Root-owned deployment entry point, callable only through the restricted gateway."""
import fcntl
from datetime import datetime, timezone
import gzip
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

BASE = Path('/opt/sunrise-travelops-dev')
STATE = BASE / 'backend'
COMPOSE = ['docker', 'compose', '--env-file', 'server.env', '-f', 'compose.dev.yml']
ID = re.compile(r'(?:[0-9a-f]{40}-[0-9]+-[0-9]+|bootstrap-[0-9]{14})')
# This destructive schema was previously misregistered as backward compatible.
# Never trust that historical flag for rollback or ordinary online migration.
BREAKING_MIGRATIONS = {'ReviseTravelPlanning1788912000000'}
INSPECT_MIGRATIONS = """
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const result = {};
for (const file of fs.readdirSync('/app/dist/migrations').filter(f => f.endsWith('.js'))) {
  const full = path.join('/app/dist/migrations', file);
  for (const Type of Object.values(require(full))) {
    if (typeof Type !== 'function' || !Type.prototype.up) continue;
    const name = new Type().name || Type.name;
    if (result[name]) throw new Error('Duplicate migration: ' + name);
    result[name] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  }
}
console.log(JSON.stringify(result));
"""


def run(command, env=None, input_file=None):
    result = subprocess.run(command, cwd=BASE, env=env, stdin=input_file,
                            capture_output=True, text=True, timeout=300)
    if result.returncode:
        with (STATE / 'operations.log').open('a') as log:
            log.write(json.dumps(command) + '\n' + result.stdout + result.stderr + '\n')
        raise RuntimeError(command[0] + ' failed; details in backend/operations.log')
    return result.stdout.strip()


def save(path, value):
    temporary = path.with_suffix(path.suffix + '.next')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def now():
    return datetime.now(timezone.utc).isoformat()


def read_state():
    return json.loads((STATE / 'state.json').read_text())


def release(release_id):
    if not ID.fullmatch(release_id):
        raise ValueError('Invalid release ID')
    return json.loads((STATE / 'releases' / (release_id + '.json')).read_text())


def migrations(image):
    return json.loads(run(['docker', 'run', '--rm', '--network', 'none',
                           '--entrypoint', 'node', image, '-e', INSPECT_MIGRATIONS]))


def applied():
    return run(COMPOSE + ['exec', '-T', 'postgres', 'psql', '-U', 'travelops',
                          '-d', 'travelops_dev', '-At', '-c',
                          'SELECT name FROM migrations ORDER BY id']).splitlines()


def check_schema(target, current, database, compatible, allow_migrations=False):
    for name in database:
        if name in target and name in current and target[name] != current[name]:
            raise ValueError('Previously executed migration changed: ' + name)
    missing = set(database) - target.keys()
    if missing & BREAKING_MIGRATIONS:
        raise ValueError('Rollback crosses a destructive migration; database recovery plan required')
    if missing - set(compatible):
        raise ValueError('Target does not support current database migrations: ' +
                         ', '.join(sorted(missing - set(compatible))))
    pending = target.keys() - set(database)
    if pending & BREAKING_MIGRATIONS:
        raise ValueError('Destructive migration requires a separate maintenance plan, not compatibility confirmation')
    if pending and not allow_migrations:
        raise ValueError('Pending migrations require manual backward-compatibility confirmation: ' +
                         ', '.join(sorted(pending)))
    return sorted(pending)


def set_image(image):
    path = BASE / 'server.env'
    lines = path.read_text().splitlines()
    if sum(line.startswith('API_IMAGE=') for line in lines) != 1:
        raise ValueError('Expected exactly one API_IMAGE in server.env')
    text = '\n'.join('API_IMAGE=' + image if line.startswith('API_IMAGE=') else line
                     for line in lines) + '\n'
    temporary = path.with_name('server.env.next')
    temporary.write_text(text)
    temporary.chmod(0o600)
    temporary.replace(path)


def activate(image):
    set_image(image)
    run(COMPOSE + ['up', '-d', '--no-deps', 'api'])
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        info = json.loads(run(['docker', 'inspect', 'sunrise-travelops-dev-api-1']))[0]
        if info['Image'] == image and info['State'].get('Health', {}).get('Status') == 'healthy':
            break
        if info['State']['Status'] in ['exited', 'dead', 'restarting'] or info['State'].get('Health', {}).get('Status') == 'unhealthy':
            raise RuntimeError('API exited or became unhealthy during deployment')
        time.sleep(3)
    else:
        raise RuntimeError('API did not become healthy within 90 seconds')
    # Nginx resolves the api service address at reload; the recreated container may have a new IP.
    run(COMPOSE + ['exec', '-T', 'nginx', 'nginx', '-t'])
    run(COMPOSE + ['exec', '-T', 'nginx', 'nginx', '-s', 'reload'])
    with urllib.request.urlopen('https://api-dev.sunrisevacation.cn/api/health', timeout=15) as response:
        result = json.load(response)
    if result.get('status') != 'ok' or result.get('details', {}).get('postgres', {}).get('status') != 'up':
        raise RuntimeError('Public API/PostgreSQL health check failed')


def activate_or_restore(candidate, previous):
    try:
        activate(candidate)
    except Exception as failure:
        try:
            activate(previous)
        except Exception as restore_failure:
            raise RuntimeError('Deployment and application rollback failed; operator attention required') from restore_failure
        raise RuntimeError('Deployment failed; previous application restored: ' + str(failure)) from failure


def cleanup_plan():
    state = read_state()
    records = {}
    for path in (STATE / 'releases').glob('*.json'):
        if path.is_symlink() or not ID.fullmatch(path.stem):
            raise ValueError('Unsafe release record')
        records[path.stem] = (json.loads(path.read_text()), path.stat().st_mtime)
    protected = {state['current'], state['previous']} - {None}
    if not protected <= records.keys():
        raise ValueError('Missing protected release record')
    recent = sorted((stamp, name) for name, (record, stamp) in records.items()
                    if record.get('status') == 'verified')[-3:]
    protected.update(name for _, name in recent)
    ids = run(['docker', 'ps', '-aq']).split()
    used = {item['Image'] for item in json.loads(run(['docker', 'inspect', *ids]))} if ids else set()
    protected.update(name for name, (record, _) in records.items() if record['image'] in used)
    protected_images = used | {records[name][0]['image'] for name in protected}
    tags = run(['docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}',
                'sunrise-travelops-api']).splitlines()
    tags = [tag for tag in tags if tag.startswith('sunrise-travelops-api:') and not tag.endswith(':<none>')]
    images = json.loads(run(['docker', 'image', 'inspect', *tags])) if tags else []
    removable_tags = sorted({tag for info in images if info['Id'] not in protected_images
                             for tag in info.get('RepoTags') or [] if tag in tags})
    return {'keep': sorted(protected), 'removeRecords': sorted(records.keys() - protected),
            'removeImageTags': removable_tags, 'cacheUntil': '168h'}


def cleanup():
    plan = cleanup_plan()
    for tag in plan['removeImageTags']:
        run(['docker', 'image', 'rm', tag])  # No force: Docker also protects container references.
    for name in plan['removeRecords']:
        (STATE / 'releases' / (name + '.json')).unlink()
    run(['docker', 'builder', 'prune', '--all', '--force', '--filter', 'until=168h'])
    return plan


def cleanup_after_success():
    try:
        print(json.dumps({'cleanup': cleanup()}), file=sys.stderr)
    except Exception as error:
        print('::warning::Backend release cleanup failed: ' + str(error), file=sys.stderr)


def publish(release_id, image, allow_migrations=False):
    if not ID.fullmatch(release_id):
        raise ValueError('Invalid release ID')
    record_path = STATE / 'releases' / (release_id + '.json')
    if record_path.exists():
        raise ValueError('Release already exists; use a new run attempt')
    state = read_state()
    previous = release(state['current'])
    target = migrations(image)
    database = applied()
    # The current image can be an older rollback target; preserve the complete applied history separately.
    pending = check_schema(target, state['migration_history'], database,
                           state['compatible_migrations'], allow_migrations)
    backup = run([str(BASE / 'backup.sh')])
    if pending:
        environment = os.environ.copy()
        environment['API_IMAGE'] = image
        migration_container = 'sunrise-api-migrate-' + release_id
        try:
            run(COMPOSE + ['run', '--rm', '--no-deps', '--name', migration_container,
                           'migrate', 'node', 'node_modules/typeorm/cli.js',
                           'migration:run', '-d', 'dist/database/data-source.js',
                           '--transaction', 'all'], env=environment)
        except Exception:
            # Killing a timed-out CLI alone would leave its migration container running.
            subprocess.run(['docker', 'rm', '-f', migration_container], capture_output=True, timeout=30)
            raise
        if set(applied()) != set(database) | set(pending):
            raise RuntimeError('Unexpected migration history; application was not switched')
        state['compatible_migrations'] = sorted(set(state['compatible_migrations']) | set(pending))
        state['migration_history'].update(target)
        state['last_migrated_at'] = now()
        save(STATE / 'state.json', state)
    record = {'release': release_id, 'image': image, 'migrations': target,
              'previous': state['current'], 'backup': backup, 'status': 'pending'}
    save(record_path, record)
    try:
        activate_or_restore(image, previous['image'])
    except Exception:
        record['status'] = 'failed'
        save(record_path, record)
        raise
    record['status'] = 'verified'
    record['deployed_at'] = now()
    save(record_path, record)
    state['previous'] = state['current']
    state['current'] = release_id
    state['last_deployed_at'] = record['deployed_at']
    state['migration_history'].update(target)
    save(STATE / 'state.json', state)
    cleanup_after_success()
    return {'release': release_id, 'previous': state['previous'], 'verified': True}


def rollback(target_id):
    state = read_state()
    if target_id == 'previous':
        target_id = state.get('previous')
    if not target_id:
        raise ValueError('No previous release available')
    target = release(target_id)
    current = release(state['current'])
    if target['status'] != 'verified':
        raise ValueError('Rollback target was not verified')
    check_schema(target['migrations'], state['migration_history'], applied(),
                 state['compatible_migrations'])
    # Ensure the immutable image still exists before touching the running service.
    run(['docker', 'image', 'inspect', target['image'], '--format', '{{.Id}}'])
    backup = run([str(BASE / 'backup.sh')])
    activate_or_restore(target['image'], current['image'])
    state['previous'] = state['current']
    state['current'] = target_id
    state['last_deployed_at'] = now()
    save(STATE / 'state.json', state)
    cleanup_after_success()
    return {'release': target_id, 'previous': state['previous'], 'verified': True, 'backup': backup}


def bootstrap():
    if (STATE / 'state.json').exists():
        raise ValueError('Deployment state is already initialized')
    release_id = 'bootstrap-' + time.strftime('%Y%m%d%H%M%S')
    image = run(['docker', 'inspect', 'sunrise-travelops-dev-api-1', '--format', '{{.Image}}'])
    target = migrations(image)
    if set(applied()) != set(target):
        raise ValueError('Bootstrap image and database migrations do not match')
    save(STATE / 'releases' / (release_id + '.json'), {
        'release': release_id, 'image': image, 'migrations': target,
        'previous': None, 'status': 'verified',
    })
    save(STATE / 'state.json', {'current': release_id, 'previous': None,
                              'compatible_migrations': [], 'migration_history': target})
    return {'current': release_id, 'image': image}


def upload(release_id, allow_migrations):
    if not re.fullmatch(r'[0-9a-f]{40}-[0-9]+-[0-9]+', release_id):
        raise ValueError('Invalid CI release ID')
    # Stream to disk; only the trusted Docker daemon reads the image archive.
    with tempfile.TemporaryFile(dir=STATE) as compressed:
        total = 0
        while block := sys.stdin.buffer.read(1024 * 1024):
            total += len(block)
            if total > 1024 * 1024 * 1024:
                raise ValueError('Compressed image exceeds 1 GiB')
            compressed.write(block)
        compressed.seek(0)
        with tempfile.TemporaryFile(dir=STATE) as archive:
            with gzip.GzipFile(fileobj=compressed) as source:
                shutil.copyfileobj(source, archive)
            archive.seek(0)
            run(['docker', 'load', '--quiet'], input_file=archive)
    sha = release_id.split('-')[0]
    tag = 'sunrise-travelops-api:sha-' + sha
    info = json.loads(run(['docker', 'image', 'inspect', tag]))[0]
    if info['Os'] != 'linux' or info['Architecture'] != 'amd64':
        raise ValueError('Expected a Linux AMD64 image')
    if info['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != sha:
        raise ValueError('Image revision does not match the requested commit')
    return publish(release_id, info['Id'], allow_migrations)


def main():
    os.umask(0o077)
    STATE.mkdir(exist_ok=True)
    (STATE / 'releases').mkdir(exist_ok=True)
    args = sys.argv[1:]
    with (STATE / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args == ['bootstrap']:
            result = bootstrap()
        elif args == ['status']:
            state = read_state()
            result = {'current': state['current'], 'previous': state['previous'],
                      'releases': [{'release': p.stem, 'status': json.loads(p.read_text())['status']}
                                   for p in sorted((STATE / 'releases').glob('*.json'))]}
        elif args in [['cleanup-plan'], ['cleanup']]:
            info = json.loads(run(['docker', 'inspect', 'sunrise-travelops-dev-api-1']))[0]
            if (info['Image'] != release(read_state()['current'])['image']
                    or info['State'].get('Health', {}).get('Status') != 'healthy'):
                raise ValueError('Current API must be verified and healthy before cleanup')
            result = cleanup_plan() if args == ['cleanup-plan'] else cleanup()
        elif len(args) == 3 and args[0] == 'deploy' and args[2] in ['true', 'false']:
            result = upload(args[1], args[2] == 'true')
        elif len(args) == 2 and args[0] == 'rollback':
            result = rollback(args[1])
        else:
            raise ValueError('Invalid deployment command')
        print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Backend deployment failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
