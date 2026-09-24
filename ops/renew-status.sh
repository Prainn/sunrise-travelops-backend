#!/bin/sh
set -eu
docker compose -f /opt/sunrise-travelops-ingress/compose.ingress.yml exec -T nginx nginx -t
docker compose -f /opt/sunrise-travelops-ingress/compose.ingress.yml exec -T nginx nginx -s reload
