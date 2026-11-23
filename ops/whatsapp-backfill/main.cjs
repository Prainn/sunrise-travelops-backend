'use strict';

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { hostname } = require('node:os');
const { isIPv4 } = require('node:net');
const { parseEnv } = require('node:util');
const { Client } = require('pg');
const Cams = require('@alicloud/cams20200606');
const Credentials = require('@alicloud/credentials').default;
const { $OpenApiUtil } = require('@alicloud/openapi-core');
const { RuntimeOptions } = require('@darabonba/typescript');
const { reconcile } = require('./reconcile.cjs');

function makeListPage(cams) {
  return async (account, startTime, endTime, index, size, recipient) => {
    const result = await cams.listChatappMessageWithOptions(new Cams.ListChatappMessageRequest({
      channelType: 'WHATSAPP', eventAction: 'UP', custSpaceId: account.spaceId,
      businessNumber: account.phone, userNumber: recipient, startTime, endTime, page: { index, size },
    }), new RuntimeOptions({ autoretry: false, maxAttempts: 1, connectTimeout: 3000, readTimeout: 8000 }));
    if (result.body?.code !== 'OK' || result.body.success === false || !Array.isArray(result.body.data))
      throw new Error('PROVIDER_LIST_FAILED');
    return result.body.data;
  };
}

async function main(args) {
  const dev = args[0] === '--dev';
  const scope = dev ? 'dev' : 'prod';
  if (hostname() !== (dev ? 'iZbp1j5n14ce3c01o1539cZ' : 'iZbp1csqgifpt738pjob5rZ'))
    throw new Error(dev ? 'DEV_HOST_REQUIRED' : 'PRODUCTION_HOST_REQUIRED');
  if (dev) args = args.slice(1);
  const [key, start, end] = args;
  if (!/^(frontend|backend)-\d+-\d+$/.test(key) || ![1, 3].includes(args.length))
    throw new Error('INVALID_RELEASE');
  const window = start === undefined ? null : { start: Number(start), end: Number(end) };
  if (window && (!Number.isSafeInteger(window.start) || !Number.isSafeInteger(window.end) ||
      window.start <= 0 || window.end < window.start || window.end > Date.now() + 60_000))
    throw new Error('INVALID_RELEASE_WINDOW');

  const base = '/opt/sunrise-travelops-' + scope;
  const env = parseEnv(readFileSync(base + '/server.env', 'utf8'));
  const port = dev ? 5432 : 5433;
  if (env.DEPLOY_ENV !== scope || env.DATABASE_HOST_PORT !== String(port) || !env.DATABASE_PASSWORD)
    throw new Error('DATABASE_ENVIRONMENT_MISMATCH');
  // Read only non-secret account identifiers from the active container, even after frontend-only releases.
  const fields = ['ENABLED', 'RECEIVE_MODE', 'SPACE_ID', 'WABA_ID', 'PHONE'];
  const readConfig = 'console.log(JSON.stringify(' + JSON.stringify(fields) +
    '.map(k=>process.env["WHATSAPP_CHAT_"+k])))';
  const [enabled, mode, spaceId, wabaId, phone] = JSON.parse(execFileSync('docker',
    ['exec', 'sunrise-travelops-' + scope + '-api-1', 'node', '-e', readConfig], { encoding: 'utf8', timeout: 10000 }));
  if (enabled !== 'true' || !['http', 'queue'].includes(mode) ||
      !spaceId || !wabaId || !/^\+?\d{5,20}$/.test(phone)) throw new Error('ACCOUNT_CONFIG_REQUIRED');

  // The dev database is reachable on its private Compose bridge only.
  const host = dev ? execFileSync('docker', ['inspect', '--format',
    '{{(index .NetworkSettings.Networks "sunrise-travelops-dev_dev").IPAddress}}', 'sunrise-travelops-dev-postgres-1'],
  { encoding: 'utf8', timeout: 10000 }).trim() : '127.0.0.1';
  if (!isIPv4(host)) throw new Error('DATABASE_ADDRESS_REQUIRED');
  const database = 'travelops_' + scope;
  const db = new Client({ host, port, database, user: 'travelops',
    password: env.DATABASE_PASSWORD, connectionTimeoutMillis: 5000, application_name: 'whatsapp-release-backfill' });
  await db.connect();
  try {
    const result = await db.query(`SELECT id,space_id AS "spaceId",waba_id AS "wabaId",phone
      FROM whatsapp_accounts WHERE current_database()=$4 AND space_id=$1 AND waba_id=$2 AND phone=$3`,
    [spaceId, wabaId, phone.replace(/^\+/, ''), database]);
    if (result.rowCount !== 1) throw new Error('ACCOUNT_MISMATCH');
    const account = result.rows[0];
    if (dev) {
      const filter = JSON.parse(readFileSync(base + '/whatsapp-backfill.json', 'utf8'));
      if (filter.accountId !== account.id || !Array.isArray(filter.recipients) ||
          !filter.recipients.length || !filter.recipients.every(id => typeof id === 'string' &&
            /^(?:\d{5,20}|[A-Z]{2}\.[A-Za-z0-9.]{1,120})$/.test(id))) throw new Error('DEV_TEST_CONTACT_REQUIRED');
      account.recipients = [...new Set(filter.recipients)];
    }
    const credential = new Credentials({ type: 'ecs_ram_role',
      roleName: dev ? 'sunrise-travelops-dev-runtime' : 'sunrise-whatsapp-runtime' });
    const cams = new Cams.default(new $OpenApiUtil.Config({ credential, endpoint: 'cams.ap-southeast-1.aliyuncs.com' }));
    console.log(JSON.stringify(await reconcile(db, account, key, window, makeListPage(cams))));
  } finally {
    await db.end();
  }
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  // SDK/SQL errors can contain raw requests. The release log only needs a diagnostic code.
  const code = [error.code, error.message].find(v => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(v));
  console.error('WhatsApp release backfill failed', code || 'BACKFILL_ERROR');
  process.exitCode = 1;
});
module.exports = { makeListPage };
