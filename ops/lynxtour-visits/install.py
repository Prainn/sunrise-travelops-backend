#!/usr/bin/env python3
"""Run on the dev host, once, from the uploaded source directory."""
import hashlib, json, os, pathlib, secrets, shutil, subprocess
BASE = pathlib.Path('/opt/lynxtour-visits-dev')
SRC = pathlib.Path(__file__).resolve().parent
NGINX = pathlib.Path('/opt/sunrise-travelops-ingress/nginx/lynxtour-visits.conf')
os.umask(0o077)
def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()
if (BASE / 'viewer.env').exists() or NGINX.exists():
    raise SystemExit('Existing deployment detected; resume explicitly, never reset credentials.')
BASE.mkdir(mode=0o700, exist_ok=True)
(BASE / 'app').mkdir(mode=0o755, exist_ok=True)
os.chmod(BASE / 'app', 0o755)
for name in ['server.cjs', 'index.html', 'app.js', 'style.css']:
    shutil.copyfile(SRC / name, BASE / 'app' / name)
    os.chmod(BASE / 'app' / name, 0o644)
for name in ['compose.yml', 'enable-https.py', 'https.conf', 'pending.conf']:
    shutil.copyfile(SRC / name, BASE / name)
password, database_password, salt = secrets.token_urlsafe(24), secrets.token_hex(32), secrets.token_hex(16)
digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=32, maxmem=64*1024*1024).hex()
# All interpolated password characters are generated hexadecimal, not user input.
sql = f"""BEGIN;
CREATE ROLE lynxtour_viewer LOGIN PASSWORD '{database_password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT 4;
GRANT CONNECT ON DATABASE travelops_dev TO lynxtour_viewer;
GRANT USAGE ON SCHEMA public TO lynxtour_viewer;
GRANT SELECT ON TABLE public.lynx_visits TO lynxtour_viewer;
ALTER ROLE lynxtour_viewer SET default_transaction_read_only = on;
ALTER ROLE lynxtour_viewer SET statement_timeout = '5s';
COMMIT;
"""
# Save secrets before the database mutation, so an interrupted run is recoverable.
(BASE / 'viewer.env').write_text(f'PGHOST=sunrise-travelops-dev-postgres-1\nPGPASSWORD={database_password}\nAUTH_USER=lynxtour\nAUTH_SALT={salt}\nAUTH_HASH={digest}\n')
credentials = {'url': 'https://lynxtour.sunrisevacation.cn', 'username': 'lynxtour', 'password': password}
(BASE / 'credentials.json').write_text(json.dumps(credentials, ensure_ascii=False, indent=2))
run(['docker', 'exec', '-i', 'sunrise-travelops-dev-postgres-1', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'travelops', '-d', 'travelops_dev'], input=sql)
# Reuse the installed Node + pg runtime, pinned to its immutable local image ID.
image = run(['docker', 'inspect', 'sunrise-travelops-dev-api-1', '--format', '{{.Image}}'])
run(['docker', 'tag', image, 'lynxtour-visits-runtime:20261015'])
(BASE / '.env').write_text(f'VIEWER_IMAGE={image}\n')
run(['docker', 'compose', '--project-directory', str(BASE), '-f', str(BASE / 'compose.yml'), 'up', '-d'])
shutil.copyfile(SRC / 'pending.conf', NGINX)
os.chmod(NGINX, 0o644)
try:
    run(['docker', 'exec', 'sunrise-travelops-ingress-nginx-1', 'nginx', '-t'])
    run(['docker', 'exec', 'sunrise-travelops-ingress-nginx-1', 'nginx', '-s', 'reload'])
except Exception:
    NGINX.unlink(missing_ok=True)
    raise
pathlib.Path('/etc/systemd/system/lynxtour-visits-tls.service').write_text('''[Unit]
Description=Enable HTTPS for Lynxtour visits after DNS is ready
After=docker.service network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/lynxtour-visits-dev/enable-https.py
TimeoutStartSec=240
''')
pathlib.Path('/etc/systemd/system/lynxtour-visits-tls.timer').write_text('''[Unit]
Description=Wait for Lynxtour visits DNS and provision TLS
[Timer]
OnActiveSec=60s
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
''')
run(['systemctl', 'daemon-reload'])
run(['systemctl', 'enable', '--now', 'lynxtour-visits-tls.timer'])
(BASE / 'installed.json').write_text(json.dumps({'state': 'deployed_waiting_dns', 'image': image}))
print(json.dumps(credentials))
