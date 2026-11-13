# Media CDN certificate renewal

`media.sunrisevacation.cn` uses the existing ECS Certbot account and a delegated DNS-01 challenge. This host-only workflow is separate from application releases and uses no static AccessKey.

- Free zone: `acme-media.sunrisevacation.cn`, delegated to `ns1.alidns.com` / `ns2.alidns.com`.
- Parent CNAME: `_acme-challenge.media` → `_acme-challenge.acme-media.sunrisevacation.cn`.
- Attach `cert-renew-policy.json` only to `sunrise-whatsapp-runtime` after explicit permission approval. It grants DNS record operations only on the dedicated validation zone and certificate updates only on the media CDN domain.
- Bundle `cert-renew.cjs` with Node dependencies (`@alicloud/credentials`, `@alicloud/openapi-client`, `@alicloud/tea-util` already installed). Install root:root 0700 at `/opt/sunrise-media-cert/renew.cjs`; directory 0700. Existing runtime: `/opt/sunrise-ci/node/bin/node`.
- Install `cert-deploy.sh` root:root 0700 as `/etc/letsencrypt/renewal-hooks/deploy/sunrise-media.sh`. Install the matching sync service/timer in `/etc/systemd/system/`, reload systemd, enable the timer, and start the service once.

Configure Certbot (staging validation must pass before settings are saved):

```sh
/snap/bin/certbot reconfigure --cert-name media.sunrisevacation.cn \
  --manual --preferred-challenges dns --non-interactive \
  --manual-auth-hook '/opt/sunrise-ci/node/bin/node /opt/sunrise-media-cert/renew.cjs auth' \
  --manual-cleanup-hook '/opt/sunrise-ci/node/bin/node /opt/sunrise-media-cert/renew.cjs cleanup'
```

Keep `snap.certbot.renew.timer` enabled; the duplicate old apt `certbot.timer` is disabled. Renewal deploys automatically; `sunrise-media-cert-sync.timer` retries every 12 hours independently, including after an upload failure. The sync operation compares live TLS with the local certificate and only uploads when different. Do not run force-renewal routinely; inspect `journalctl -u sunrise-media-cert-sync.service` and `/var/log/letsencrypt/letsencrypt.log` on failure.

The DNS hook modifies only its exact challenge TXT value, waits up to 15 minutes for both recursive resolvers, then cleans up after validation. Private keys stay in Certbot storage and are transmitted only to the official CDN HTTPS API. Raw SDK errors are deliberately not logged. Certbot staging certificates must never be deployed. Existing ingress reload hook and ops/api webroot renewals remain in place.

2026-11-12 acceptance: ops and ops-dev simulated renewals plus ingress reload passed; media DNS-01 reconfigure passed; one real renewal uploaded a new certificate and public TLS serial/fingerprint matched the local certificate. This did not deploy application images or change customer messages.
