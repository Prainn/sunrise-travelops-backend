#!/usr/bin/env python3
"""Provision this domain after its DNS is pointed at the dev host."""
import pathlib, socket, subprocess
DOMAIN = 'lynxtour.sunrisevacation.cn'
BASE = pathlib.Path('/opt/lynxtour-visits-dev')
CONFIG = pathlib.Path('/opt/sunrise-travelops-ingress/nginx/lynxtour-visits.conf')
CERT = pathlib.Path('/etc/letsencrypt/live') / DOMAIN / 'fullchain.pem'
def run(args):
    subprocess.run(args, check=True, timeout=180)
if not CERT.exists():
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(DOMAIN, 80)}
    except socket.gaierror:
        raise SystemExit(0)
    if addresses != {'47.114.79.126'}:
        raise SystemExit(0)
    run(['certbot', 'certonly', '--webroot', '-w', '/opt/sunrise-travelops-dev/acme', '--cert-name', DOMAIN, '-d', DOMAIN, '--non-interactive', '--agree-tos', '--register-unsafely-without-email'])
previous = CONFIG.read_text()
CONFIG.write_text((BASE / 'https.conf').read_text())
try:
    run(['docker', 'exec', 'sunrise-travelops-ingress-nginx-1', 'nginx', '-t'])
    run(['docker', 'exec', 'sunrise-travelops-ingress-nginx-1', 'nginx', '-s', 'reload'])
except Exception:
    CONFIG.write_text(previous)
    raise
run(['systemctl', 'disable', '--now', 'lynxtour-visits-tls.timer'])
