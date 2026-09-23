#!/usr/bin/python3
"""SSH forced command for sunrise-api-deploy; no arbitrary sudo arguments."""
import os
import re
import sys

command = os.environ.get('SSH_ORIGINAL_COMMAND', '')
release = r'(?:[0-9a-f]{40}-[0-9]+-[0-9]+|bootstrap-[0-9]{14})'
if not re.fullmatch(r'(?:status|preflight [0-9a-f]{40} (?:true|false)|deploy [0-9a-f]{40}-[0-9]+-[0-9]+ (?:true|false) [0-9]{1,10}|rollback (?:previous|' + release + '))', command):
    sys.exit('Only status, preflight, deploy, and rollback commands are permitted')
os.execv('/usr/bin/sudo', ['sudo', '-n', '/usr/local/sbin/sunrise-api-deploy', *command.split()])
