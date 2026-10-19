#!/usr/bin/env python3
"""Upload standalone sources and install on the dev host. No business release."""
import io, json, os, pathlib, subprocess, tarfile
SOURCE = pathlib.Path(__file__).resolve().parent
SSH = ['ssh', '-i', '/Users/joe/Desktop/wtf/私钥/murphy.pem', '-o', 'UserKnownHostsFile=/Users/joe/.ssh/sunrise-travelops-known-hosts', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=10', 'root@47.114.79.126']
archive = io.BytesIO()
with tarfile.open(fileobj=archive, mode='w:gz') as tar:
    for name in ['server.cjs', 'index.html', 'app.js', 'style.css', 'compose.yml', 'install.py', 'enable-https.py', 'https.conf', 'pending.conf']:
        tar.add(SOURCE / name, arcname=name)
result = subprocess.run(SSH + ['umask 077; mkdir -p /opt/lynxtour-visits-upload; tar xzf - -C /opt/lynxtour-visits-upload; python3 /opt/lynxtour-visits-upload/install.py'], input=archive.getvalue(), capture_output=True)
if result.returncode:
    print(result.stderr.decode())
    raise SystemExit(result.returncode)
credentials = json.loads(result.stdout)
private = pathlib.Path('/Users/joe/.codex/private/lynxtour-visits-login.json')
private.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
fd = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as file:
    json.dump(credentials, file, ensure_ascii=False, indent=2)
print(f'Deployed standalone service. Credentials saved to {private}. TLS waits for DNS.')
