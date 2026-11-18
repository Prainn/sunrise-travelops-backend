/** Two disposable localhost databases and a real TLS API; never reads application .env. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer, Server } from 'node:https';
import { AddressInfo } from 'node:net';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { IsolationHarness, Actor } from './business-isolation.harness';
import {
  copyVisitSource,
  VisitCopyConflict,
} from '../src/lynx/visit-source-copy';
import { WebsiteVisitsHttpSource } from '../src/lynx/website-visits-http.source';
import { WebsiteVisitsDatabaseSource } from '../src/lynx/website-visits-database.source';
import { WebsiteVisitsQuery } from '../src/lynx/website-visits.dto';
import { validateVisitsEnvironment } from '../src/lynx/website-visits-api.config';

const root = process.env.VISITS_TEST_TLS_DIR;
if (!root) {
  const dir = mkdtempSync(join(tmpdir(), 'sunrise-visits-api-'));
  try {
    const certificate = spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=visits-isolation.test',
        '-addext',
        'subjectAltName=DNS:visits-isolation.test,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    assert.equal(certificate.status, 0, 'Test certificate generation failed');
    const child = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register', __filename],
      {
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem'),
          VISITS_TEST_TLS_DIR: dir,
        },
        stdio: 'inherit',
      },
    );
    process.exitCode = child.status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  void run(root).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

interface Visit {
  id: string;
  confirmed: boolean;
  converted: boolean;
  inquiry: { id: string; code: string } | null;
}
type Page = { list: Visit[]; total: number };
const ledger = '/ledgers/website-visits';
async function run(dir: string) {
  const tls = {
    key: readFileSync(join(dir, 'key.pem')),
    cert: readFileSync(join(dir, 'cert.pem')),
  };
  const secret = randomBytes(32).toString('hex');
  const role = 'visit_api_reader_' + randomBytes(6).toString('hex');
  const config: Record<string, string> = {
    LYNX_VISITS_DB_HOST: '127.0.0.1',
    LYNX_VISITS_DB_PORT: process.env.ISOLATION_PG_PORT ?? '55457',
    LYNX_VISITS_DB_USER: role,
    LYNX_VISITS_DB_PASSWORD: 'test-reader-only',
    LYNX_VISITS_API_ENABLED: 'true',
    LYNX_VISITS_API_SERVER_TOKEN: secret,
    LYNX_VISITS_API_ALLOWED_IPS: '127.0.0.1',
  };
  const production = new IsolationHarness(config, {
    lynx: true,
    httpsOptions: tls,
  });
  config.LYNX_VISITS_DB_NAME = production.databaseName;
  const developmentConfig: Record<string, string> = {
    LYNX_VISITS_SOURCE_MODE: 'http',
    LYNX_VISITS_API_CLIENT_TOKEN: secret,
    LYNX_VISITS_API_CONNECT_IP: '127.0.0.1',
  };
  const development = new IsolationHarness(developmentConfig, { lynx: true });
  let createdRole = false,
    fake: Server | undefined;
  let checks = 0;
  const passed = (label: string) => console.log(`PASS ${++checks}: ${label}`);
  const visits = Array.from({ length: 4 }, () => randomUUID());
  const rows = (db: DataSource) =>
    db.query<Record<string, string | null>[]>(
      'SELECT *,created_at_utc::text AS created_at_utc,expires_at_utc::text AS expires_at_utc FROM lynx_visits ORDER BY id',
    );
  const count = async (db: DataSource, table: string) =>
    Number(
      (await db.query<{ n: string }[]>(`SELECT count(*) AS n FROM ${table}`))[0]
        .n,
    );
  const seed = async (
    db: DataSource,
    id: string,
    reference: string,
    expired = false,
  ) =>
    db.query<void>(
      `INSERT INTO lynx_visits(id,whatsapp_reference,website_inquiry_id,contract_version,first_landing_page,
      external_referrer,utm_source,created_at_utc,expires_at_utc,payload_fingerprint)
     VALUES($1,$2,$2,'test','https://example.test/云南?a=1',NULL,'=formula', $3::timestamptz,
       $3::timestamptz + interval '4320 hours',repeat('a',64))`,
      [
        id,
        reference,
        expired ? '2025-01-01T00:00:00.123456Z' : '2026-11-16T12:00:00.123456Z',
      ],
    );
  try {
    validateVisitsEnvironment(config);
    await production.start();
    await production.db.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD 'test-reader-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4`,
    );
    createdRole = true;
    await production.db.query(
      `GRANT CONNECT ON DATABASE "${production.databaseName}" TO "${role}"`,
    );
    await production.db.query(
      `GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT ON lynx_visits TO "${role}"; ALTER ROLE "${role}" SET default_transaction_read_only=on; ALTER ROLE "${role}" SET statement_timeout='5s'`,
    );
    developmentConfig.LYNX_VISITS_API_URL = production.url
      .replace('127.0.0.1', 'visits-isolation.test')
      .replace(/\/api$/, '');
    validateVisitsEnvironment(developmentConfig);
    await development.start();
    for (const [index, id] of visits.entries())
      await seed(development.db, id, `LX-SOURCE-${index}`, index === 3);
    await development.db.query(
      'INSERT INTO website_visit_confirmations VALUES($1)',
      [visits[0]],
    );
    const original = await rows(development.db);
    const plan = await copyVisitSource(development.db, production.db);
    assert.equal(plan.inserted, 0);
    assert.equal(plan.missingIds.length, 4);
    assert.equal(await count(production.db, 'lynx_visits'), 0);
    assert.equal(
      (await copyVisitSource(development.db, production.db, true)).inserted,
      4,
    );
    assert.deepEqual(await rows(production.db), original);
    assert.equal(await count(production.db, 'website_visit_confirmations'), 0);
    const repeat = await copyVisitSource(development.db, production.db, true);
    assert.equal(repeat.identical, 4);
    assert.equal(repeat.inserted, 0);
    passed(
      'Dry run, exact UUID/17-column/microsecond preservation, idempotence, no confirmation copy',
    );

    const newProductionId = randomUUID(),
      referenceConflict = randomUUID(),
      otherwiseMissing = randomUUID();
    await seed(production.db, newProductionId, 'LX-PRODUCTION-ONLY');
    await seed(development.db, referenceConflict, 'LX-PRODUCTION-ONLY');
    await seed(development.db, otherwiseMissing, 'LX-ATOMIC-MISSING');
    const beforeConflict = await rows(production.db);
    await assert.rejects(
      copyVisitSource(development.db, production.db, true),
      VisitCopyConflict,
    );
    assert.deepEqual(await rows(production.db), beforeConflict);
    await development.db.query('DELETE FROM lynx_visits WHERE id=$1', [
      referenceConflict,
    ]);
    await development.db.query(
      "UPDATE lynx_visits SET contract_version='conflicting' WHERE id=$1",
      [visits[0]],
    );
    await assert.rejects(
      copyVisitSource(development.db, production.db, true),
      VisitCopyConflict,
    );
    assert.deepEqual(await rows(production.db), beforeConflict);
    await development.db.query(
      "UPDATE lynx_visits SET contract_version='test' WHERE id=$1",
      [visits[0]],
    );
    await development.db.query('DELETE FROM lynx_visits WHERE id=$1', [
      otherwiseMissing,
    ]);
    assert.equal(
      (await copyVisitSource(development.db, production.db, true)).inserted,
      0,
    );
    await assert.rejects(
      copyVisitSource(production.db, production.db, true),
      /different databases/,
    );
    passed(
      'UUID/content and reference/UUID conflicts roll back all rows; production-only increment retained',
    );

    const productionUser = await production.actor('website');
    const developmentUser = await development.actor('website');
    const outsider = await development.actor('linxi');
    const list = (h: IsolationHarness, actor: Actor) =>
      h.call<Page>(actor, 'GET', ledger);
    const state = async (h: IsolationHarness, actor: Actor, id: string) =>
      (await list(h, actor)).list.find((v) => v.id === id)!;
    assert.equal((await list(development, developmentUser)).total, 5);
    assert.equal(
      (await state(development, developmentUser, visits[0])).confirmed,
      true,
    );
    assert.equal(
      (await state(production, productionUser, visits[0])).confirmed,
      false,
    );
    await production.call(
      productionUser,
      'POST',
      `${ledger}/${visits[1]}/confirm`,
    );
    assert.equal(
      (await state(production, productionUser, visits[1])).confirmed,
      true,
    );
    assert.equal(
      (await state(development, developmentUser, visits[1])).confirmed,
      false,
    );
    await development.call(
      developmentUser,
      'POST',
      `${ledger}/${visits[2]}/confirm`,
    );
    await development.call(
      developmentUser,
      'POST',
      `${ledger}/${visits[2]}/confirm`,
    );
    assert.equal(
      (await state(development, developmentUser, visits[2])).confirmed,
      true,
    );
    assert.equal(
      (await state(production, productionUser, visits[2])).confirmed,
      false,
    );
    assert.equal(await count(production.db, 'website_visit_confirmations'), 1);
    assert.equal(await count(development.db, 'website_visit_confirmations'), 2);
    await development.call(
      outsider,
      'POST',
      `${ledger}/${visits[1]}/confirm`,
      undefined,
      403,
      'AUTH_FORBIDDEN',
    );
    await development.call(
      undefined,
      'GET',
      ledger,
      undefined,
      401,
      'AUTH_TOKEN_INVALID',
    );
    passed(
      'Real HTTPS reads with JWT-protected business routes; pre-existing and new confirmation states stay local',
    );

    const makeInquiry = async (h: IsolationHarness, actor: Actor) => {
      const [country] = await h.db.query<{ id: string }[]>(
        "SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' ORDER BY i.code LIMIT 1",
      );
      assert(country);
      return h.call<{ id: string }>(
        actor,
        'POST',
        `${ledger}/${visits[1]}/inquiry`,
        {
          countryItemId: country.id,
          customerName: 'Isolated visit fixture',
          plannedDays: 1,
          requirements: 'Isolated fixture',
          receivedAt: null,
        },
        201,
      );
    };
    const prodInquiry = await makeInquiry(production, productionUser);
    assert.equal(
      (await state(production, productionUser, visits[1])).converted,
      true,
    );
    assert.equal(
      (await state(development, developmentUser, visits[1])).converted,
      false,
    );
    const devInquiry = await makeInquiry(development, developmentUser);
    assert.notEqual(prodInquiry.id, devInquiry.id);
    assert.equal(
      (await state(production, productionUser, visits[1])).inquiry?.id,
      prodInquiry.id,
    );
    assert.equal(
      (await state(development, developmentUser, visits[1])).inquiry?.id,
      devInquiry.id,
    );
    await development.call(
      developmentUser,
      'POST',
      `${ledger}/${visits[1]}/inquiry`,
      {
        countryItemId: (
          await development.db.query<{ id: string }[]>(
            'SELECT country_item_id AS id FROM website_inquiries WHERE id=$1',
            [devInquiry.id],
          )
        )[0].id,
        customerName: 'Duplicate',
        plannedDays: 1,
        requirements: 'duplicate',
      },
      409,
      'CONFLICT',
    );
    assert.equal(await count(production.db, 'website_visit_inquiries'), 1);
    assert.equal(await count(development.db, 'website_visit_inquiries'), 1);
    assert.deepEqual(await rows(production.db), beforeConflict);
    passed(
      'Real inquiry transactions create one local inquiry per source UUID in each environment; source data unchanged',
    );

    const machine = async (
      path = '',
      token: string | undefined = secret,
      init: RequestInit = {},
    ) =>
      fetch(production.url + '/internal/website-visits' + path, {
        ...init,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      });
    assert.equal((await machine('', '')).status, 401);
    assert.equal((await machine('', productionUser.token)).status, 401);
    assert.equal((await machine('', 'wrong')).status, 401);
    assert.equal((await machine('', secret, { method: 'POST' })).status, 404);
    assert.equal((await machine('', secret, { method: 'HEAD' })).status, 405);
    assert.equal((await machine('?extra=unexpected')).status, 400);
    assert.equal((await machine('/' + randomUUID())).status, 404);
    assert.equal((await machine('/' + visits[3])).status, 200);
    const serverConfig = production.get(ConfigService);
    serverConfig.set('LYNX_VISITS_API_ALLOWED_IPS', '192.0.2.1');
    assert.equal(
      (
        await machine('', secret, {
          headers: { 'x-forwarded-for': '192.0.2.1' },
        })
      ).status,
      403,
    );
    serverConfig.set('LYNX_VISITS_API_ALLOWED_IPS', '127.0.0.1');
    const raw = await machine('', secret, {
      headers: { origin: 'https://lynxtour.cn' },
    });
    assert.equal(raw.headers.get('access-control-allow-origin'), null);
    const rawBody = (await raw.json()) as { data: Page };
    assert(
      rawBody.data.list.every(
        (v) => !('confirmed' in v) && !('converted' in v) && !('inquiry' in v),
      ),
    );
    const page = await development.call<Page>(
      developmentUser,
      'GET',
      `${ledger}?page=1&pageSize=1&keyword=LX-SOURCE&start=2026-11-16&end=2026-11-16`,
    );
    assert.equal(page.total, 3);
    assert.equal(page.list.length, 1);
    await development.call(
      developmentUser,
      'GET',
      `${ledger}?start=2026-11-16`,
      undefined,
      400,
      'VALIDATION_ERROR',
    );
    await development.call(
      developmentUser,
      'GET',
      `${ledger}/${randomUUID()}/inquiry-draft`,
      undefined,
      404,
      'NOT_FOUND',
    );
    passed(
      'Dedicated token, source IP, GET-only, no CORS, no business states, expired UUID details and query validation',
    );

    const query = '/export?start=2026-11-16&end=2026-11-16';
    const remoteCsv = await fetch(development.url + ledger + query, {
      headers: { authorization: `Bearer ${developmentUser.token}` },
    });
    const csv = Buffer.from(await remoteCsv.arrayBuffer());
    assert.equal(remoteCsv.status, 200);
    assert.equal(csv.subarray(0, 3).toString('hex'), 'efbbbf');
    assert(csv.toString().includes("'=formula"));
    assert(!csv.toString().includes(visits[3]));
    const localCsv = Buffer.from(await (await machine(query)).arrayBuffer());
    assert.deepEqual(csv, localCsv);
    const unread = await production.get(WebsiteVisitsDatabaseSource).export(
      Object.assign(new WebsiteVisitsQuery(), {
        start: '2026-11-16',
        end: '2026-11-16',
      }),
    );
    unread.getStream().destroy();
    // Pool limit is three. More than three reads must complete after an unopened export is cancelled.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        production
          .get(WebsiteVisitsDatabaseSource)
          .list(new WebsiteVisitsQuery()),
      ),
    );
    passed(
      'Remote CSV is byte-identical, BOM/formula/date rules preserved; cancelled export releases its reader',
    );

    serverConfig.set('LYNX_VISITS_API_ENABLED', 'false');
    await development.call(
      developmentUser,
      'GET',
      ledger,
      undefined,
      503,
      'INTERNAL_SERVER_ERROR',
    );
    await development.call(
      developmentUser,
      'POST',
      `${ledger}/${newProductionId}/confirm`,
      undefined,
      503,
      'INTERNAL_SERVER_ERROR',
    );
    assert.equal(await count(development.db, 'website_visit_confirmations'), 2);
    serverConfig.set('LYNX_VISITS_API_ENABLED', 'true');
    assert.equal(
      (
        await fetch(development.url + '/internal/website-visits', {
          headers: { authorization: `Bearer ${secret}` },
        })
      ).status,
      503,
    );
    passed(
      'Disabled upstream fails closed without stale local fallback or confirmation writes; dev machine API stays disabled',
    );

    for (const [h, actor] of [
      [production, developmentUser],
      [development, productionUser],
    ] as const)
      await h.call(actor, 'GET', ledger, undefined, 401, 'AUTH_TOKEN_INVALID');
    await production.db.query(
      'ALTER TABLE lynx_visits ADD COLUMN unexpected_copy_field text',
    );
    await assert.rejects(
      copyVisitSource(development.db, production.db, true),
      /schemas must match/,
    );
    await production.db.query(
      'ALTER TABLE lynx_visits DROP COLUMN unexpected_copy_field',
    );
    const registration = {
      whatsapp_reference: 'LX-REGISTRATION',
      website_inquiry_id: 'wi-registration',
      contract_version: 'test',
      first_landing_page: 'https://example.test/?utm_source=测试',
    };
    const register = (
      h: IsolationHarness,
      form: boolean,
      body = registration,
    ) =>
      fetch(h.url + '/v1/whatsapp/register', {
        method: 'POST',
        headers: {
          'content-type': form
            ? 'application/x-www-form-urlencoded'
            : 'application/json',
        },
        body: form
          ? new URLSearchParams(body).toString()
          : JSON.stringify(body),
      });
    assert.equal((await register(production, true)).status, 201);
    assert.equal((await register(production, false)).status, 200);
    assert.equal(
      (
        await register(production, true, {
          ...registration,
          contract_version: 'conflict',
        })
      ).status,
      409,
    );
    assert.equal((await register(development, true)).status, 503);
    assert.equal(
      (await fetch(development.url + '/v1/private/whatsapp')).status,
      503,
    );
    assert.equal(
      (await fetch(development.url + '/v1/private/whatsapp/LX-REGISTRATION'))
        .status,
      503,
    );
    assert.equal(await count(development.db, 'lynx_visits'), 4);
    const registered = (await list(development, developmentUser)).list.find(
      (v) => !beforeConflict.some((row) => row.id === v.id),
    );
    assert(
      registered,
      'Production registration becomes visible through HTTP without local copying',
    );
    assert.equal(registered.confirmed, false);
    assert.equal(registered.converted, false);
    passed(
      'Schema drift rejected; cross-environment JWT rejected; form/JSON registration idempotent at canonical source; HTTP-mode dev cannot register or read stale legacy data',
    );

    let behavior = 'redirect',
      received = 0;
    fake = createServer(tls, (req, res) => {
      received++;
      assert.equal(req.headers.authorization, `Bearer ${secret}`);
      if (behavior === 'timeout') return;
      if (behavior === 'redirect') {
        res.writeHead(302, {
          location: production.url + '/internal/website-visits',
        });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"code":"SUCCESS","data":{"list":[],"total":"bad"}}');
    });
    await new Promise<void>((resolve) => fake!.listen(0, '127.0.0.1', resolve));
    const fakeConfig = new ConfigService({
      LYNX_VISITS_API_URL: `https://visits-isolation.test:${(fake.address() as AddressInfo).port}`,
      LYNX_VISITS_API_CONNECT_IP: '127.0.0.1',
      LYNX_VISITS_API_CLIENT_TOKEN: secret,
    });
    const client = new WebsiteVisitsHttpSource(fakeConfig);
    try {
      await assert.rejects(client.list(new WebsiteVisitsQuery()));
      assert.equal(received, 1);
      behavior = 'invalid';
      await assert.rejects(client.list(new WebsiteVisitsQuery()));
      fakeConfig.set(
        'LYNX_VISITS_API_URL',
        `https://wrong-hostname.test:${(fake.address() as AddressInfo).port}`,
      );
      await assert.rejects(client.list(new WebsiteVisitsQuery()));
      assert.equal(received, 2);
      fakeConfig.set(
        'LYNX_VISITS_API_URL',
        `https://visits-isolation.test:${(fake.address() as AddressInfo).port}`,
      );
      behavior = 'timeout';
      const start = Date.now();
      await assert.rejects(client.list(new WebsiteVisitsQuery()));
      assert(Date.now() - start < 6500);
    } finally {
      client.onModuleDestroy();
    }
    assert.throws(() =>
      validateVisitsEnvironment({
        ...developmentConfig,
        LYNX_VISITS_API_URL: 'http://example.test',
      }),
    );
    assert.throws(() =>
      validateVisitsEnvironment({ ...config, LYNX_VISITS_SOURCE_MODE: 'http' }),
    );
    assert.throws(() =>
      validateVisitsEnvironment({ ...config, JWT_SECRET: secret }),
    );
    passed(
      'Redirects, malformed responses, TLS hostname mismatch and timeouts rejected; HTTP/plaintext/token reuse config rejected',
    );
    console.log(
      `PASS: ${checks} visit API/migration/isolation groups; no business environment accessed`,
    );
  } finally {
    if (fake) {
      fake.closeAllConnections();
      await new Promise<void>((resolve) => fake!.close(() => resolve()));
    }
    await development.close();
    await production.close();
    if (createdRole) {
      const cleanup = new DataSource({
        type: 'postgres',
        host: '127.0.0.1',
        port: Number(process.env.ISOLATION_PG_PORT ?? '55457'),
        username: 'postgres',
        password: process.env.ISOLATION_PG_PASSWORD ?? 'isolation-ci-only',
        database: 'postgres',
      });
      try {
        await cleanup.initialize();
        await cleanup.query(`DROP ROLE "${role}"`);
      } finally {
        if (cleanup.isInitialized) await cleanup.destroy();
      }
    }
  }
}
