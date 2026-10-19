#!/usr/bin/env python3
"""Update only the standalone viewer; retain credentials, DB grants and ingress."""
import io, pathlib, subprocess, tarfile
from datetime import datetime, timezone
SOURCE = pathlib.Path(__file__).resolve().parent
SSH = ['ssh', '-i', '/Users/joe/Desktop/wtf/私钥/murphy.pem', '-o', 'UserKnownHostsFile=/Users/joe/.ssh/sunrise-travelops-known-hosts', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=10', 'root@47.114.79.126']
release = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
archive = io.BytesIO()
with tarfile.open(fileobj=archive, mode='w:gz') as tar:
    for name in ['server.cjs', 'index.html', 'app.js', 'style.css']:
        tar.add(SOURCE / name, arcname=name)
remote = f'''set -eu
umask 077
cd /opt/lynxtour-visits-dev
test -f viewer.env
mkdir -p releases/{release}/previous releases/{release}/next
tar xzf - -C releases/{release}/next
cp app/server.cjs app/index.html app/app.js app/style.css releases/{release}/previous/
cp releases/{release}/next/* app/
chmod 644 app/server.cjs app/index.html app/app.js app/style.css
docker compose -f compose.yml restart viewer
'''
result = subprocess.run(SSH + [remote], input=archive.getvalue())
if result.returncode:
    raise SystemExit(f'Update failed; inspect /opt/lynxtour-visits-dev/releases/{release} before retry.')
print(f'Updated standalone viewer; previous source saved in releases/{release}/previous.')
