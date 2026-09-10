#!/bin/sh
set -eu
if [ "$RENEWED_LINEAGE" = /etc/letsencrypt/live/status.sunrisevacation.cn ]; then
  cd /opt/sunrise-travelops-dev
  docker compose --env-file server.env -f compose.dev.yml exec -T nginx nginx -t
  docker compose --env-file server.env -f compose.dev.yml exec -T nginx nginx -s reload
fi
