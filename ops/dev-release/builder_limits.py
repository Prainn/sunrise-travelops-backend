#!/usr/bin/python3
"""Install bounds only on the dev executor subtree inside the existing builder."""
import re
import socket
import subprocess
from pathlib import Path

if socket.gethostname() != 'iZbp1csqgifpt738pjob5rZ':
    raise SystemExit('Unexpected dev build host')
worker, pid = subprocess.check_output(['docker', 'inspect', '--format', '{{.Id}} {{.State.Pid}}',
                                       'buildx_buildkit_sunrise0'], text=True).split()
if not re.fullmatch(r'[0-9a-f]{64}', worker) or not pid.isdigit():
    raise SystemExit('Invalid worker identity')
scope = '/system.slice/docker-' + worker + '.scope'
if Path('/proc', pid, 'cgroup').read_text().strip() not in ('0::' + scope, '0::' + scope + '/init'):
    raise SystemExit('Unexpected build worker cgroup')
group = Path('/sys/fs/cgroup' + scope) / 'sunrise-devcompile.slice'
group.mkdir(exist_ok=True)
for name, limit in [('memory.max', '754974720'), ('memory.high', '692060160'), ('cpu.max', '85000 100000')]:
    (group / name).write_text(limit)
    if (group / name).read_text().strip() != limit:
        raise SystemExit('Dev build worker limit differs')
