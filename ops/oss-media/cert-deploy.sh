#!/bin/sh
set -eu
test "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/media.sunrisevacation.cn || exit 0
exec /opt/sunrise-ci/node/bin/node /opt/sunrise-media-cert/renew.cjs sync
