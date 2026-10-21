import { ConfigService } from '@nestjs/config';
import { WebsiteVisitsController } from '../src/lynx/website-visits.controller';
import { WebsiteVisitsService } from '../src/lynx/website-visits.service';
import { WebsiteVisitsReader } from '../src/lynx/website-visits-reader';
/** Disposable localhost PostgreSQL 16 only; never loads application .env files. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthenticatedUser } from '../src/auth/auth.types';
import { effectivePermissions } from '../src/auth/identity-permissions';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { createValidationException } from '../src/common/validation/validation-exception.factory';
import { WebsiteController } from '../src/website/website.controller';
import { WebsiteService } from '../src/website/website.service';
import { WebsiteInquiry, WebsiteItinerary } from '../src/website/website.types';

const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55451,
  username: 'postgres',
  password: 'isolated-website-fields-test',
};
const admin = new DataSource({ ...connection, database: 'postgres' });
const names = [
  `website_fields_empty_${Date.now()}`,
  `website_fields_upgrade_${Date.now()}`,
];
const source = (database: string) =>
  new DataSource({
    ...connection,
    database,
    synchronize: false,
    migrations: ['src/migrations/*.ts'],
    entities: ['src/**/*.entity.ts'],
  });
const actors: Record<string, AuthenticatedUser> = {};
let db: DataSource;
let app: INestApplication | undefined;
let base = '';
let requests = 0;
async function call<T = WebsiteInquiry>(
  actor: string,
  method: string,
  path: string,
  body?: unknown,
  expected = 200,
): Promise<T> {
  const response = await fetch(
    `${base}/api${path.startsWith('/') ? path : `/website/${path}`}`,
    {
      method,
      headers: { 'content-type': 'application/json', 'x-test-actor': actor },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const payload = (await response.json()) as { code: string; data: T };
  assert.equal(
    response.status,
    expected,
    `${actor} ${method} ${path}: ${JSON.stringify(payload)}`,
  );
  if (expected === 400) assert.equal(payload.code, 'VALIDATION_ERROR');
  if (expected === 409)
    assert.equal(
      payload.code,
      path.startsWith('/ledgers/') ? 'CONFLICT' : 'INQUIRY_VERSION_CONFLICT',
    );
  requests++;
  return payload.data;
}
async function actor(
  name: string,
  scope: AuthenticatedUser['scope'],
  code: string | null = 'AS',
  role = 'COORDINATOR',
) {
  const id = randomUUID(),
    identityId = randomUUID();
  await db.query(
    `INSERT INTO users(id,username,password_hash,nickname,english_name,tour_code) VALUES($1,$2,'test-only',$2,$2,$3)`,
    [id, name, code],
  );
  const dept =
    scope === 'headquarters'
      ? null
      : { shengxu: 3, linxi: 5, website: 7 }[scope];
  await db.query(
    'INSERT INTO user_identities(id,user_id,username,scope,dept_id) VALUES($1,$2,$3,$4,$5)',
    [identityId, id, name, scope, dept],
  );
  await db.query(
    'INSERT INTO identity_roles(identity_id,role_id) SELECT $1,id FROM roles WHERE code=$2',
    [identityId, role],
  );
  actors[name] = {
    id,
    identityId,
    scope,
    roles: [role],
    permissions: effectivePermissions(scope, [role]),
    username: name,
    nickname: name,
    scopeName: scope,
    deptId: dept,
    deptName: '',
    menuKeys: [],
  };
  return id;
}
async function run() {
  await admin.initialize();
  try {
    assert.match(
      (
        await admin.query<{ server_version: string }[]>('SHOW server_version')
      )[0].server_version,
      /^16\./,
    );
    for (const name of names) await admin.query(`CREATE DATABASE "${name}"`);
    db = await source(names[0]).initialize();
    assert.equal((await db.runMigrations()).length, db.migrations.length);
    assert.equal((await db.runMigrations()).length, 0);
    await db.destroy();
    db = await source(names[1]).initialize();
    const all = [...db.migrations];
    db.migrations.splice(
      0,
      db.migrations.length,
      ...all.filter(
        (m) =>
          ![
            'UpdateWebsiteInquiryFields1792886400000',
            'AddWebsiteVisitLedger1792972800000',
          ].includes(m.name ?? m.constructor.name),
      ),
    );
    await db.runMigrations();
    const owner = await actor('web', 'website');
    await actor('linxi', 'linxi');
    await actor('other', 'website', 'OT');
    await actor('noCode', 'website', null);
    await actor('digits', 'website', 'AS1');
    await actor('root', 'headquarters', 'ROOT', 'ROOT');
    await actor('readonly', 'headquarters', 'READ', 'EXECUTIVE');
    await actor('shengxu', 'shengxu', 'SX');
    await db.query(
      `INSERT INTO system_business_dictionary_items(type_id,code,name,english_name) SELECT id,'MYS','马来西亚','Malaysia' FROM system_business_dictionary_types WHERE code='country-region'`,
    );
    const [country] = await db.query<{ id: string }[]>(
      `SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' AND i.code='MYS'`,
    );
    const [unknown] = await db.query<{ id: string }[]>(
      `SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' AND i.code='UNKNOWN'`,
    );
    const legacy = randomUUID(),
      emptyPhone = randomUUID(),
      itinerary = randomUUID(),
      quote = randomUUID();
    for (const [id, phone] of [
      [legacy, 'legacy-phone'],
      [emptyPhone, ''],
    ]) {
      await db.query(
        `INSERT INTO website_inquiries(id,code,customer_name,planned_days,requirements,owner_id,owner,phone,email,arrival_time,departure_time,status,business_unit,country_item_id,country_code,country_or_region) VALUES($1,$2,'Legacy',1,'old',$3,'web',$4,'discard@example.test','10:00','20:00','new','website',$5,'MYS','马来西亚')`,
        [id, `WIQ-OLD-${id}`, owner, phone, country.id],
      );
    }
    await db.query(
      `INSERT INTO website_itineraries(id,inquiry_id,code,title,duration,arrival_time,departure_time,config_version,business_unit) VALUES($1,$2,'WIT-OLD','Old',1,'11:00','21:00',0,'website')`,
      [itinerary, legacy],
    );
    const snapshot = {
      inquiry: { phone: 'frozen-phone', email: 'frozen-email' },
      marker: 'unchanged',
    };
    await db.query(
      `INSERT INTO website_quotations(id,itinerary_id,code,snapshot,confirmed_by) VALUES($1,$2,'WQT-OLD',$3,$4)`,
      [quote, itinerary, snapshot, owner],
    );
    const [before] = await db.query<{ code: string; updated_at: Date }[]>(
      'SELECT code,updated_at FROM website_inquiries WHERE id=$1',
      [legacy],
    );
    db.migrations.splice(
      0,
      db.migrations.length,
      ...all.filter(
        (m) =>
          (m.name ?? m.constructor.name) !==
          'AddWebsiteVisitLedger1792972800000',
      ),
    );
    assert.equal((await db.runMigrations()).length, 1);
    await db.query(
      `UPDATE website_inquiries SET received_date='2024-02-29', received_time='23:59' WHERE id=$1`,
      [legacy],
    );
    await db.query(
      `UPDATE website_inquiries SET received_date='2026-10-21' WHERE id=$1`,
      [emptyPhone],
    );
    const timeOnly = randomUUID();
    await db.query(
      `INSERT INTO website_inquiries(id,code,customer_name,planned_days,requirements,owner_id,owner,status,business_unit,country_item_id,country_code,country_or_region,received_time) VALUES($1,'WIQ-TIME-ONLY','Time only',1,'old',$2,'web','new','website',$3,'MYS','马来西亚','11:52')`,
      [timeOnly, owner, country.id],
    );
    db.migrations.splice(0, db.migrations.length, ...all);
    assert.equal((await db.runMigrations()).length, 1);
    for (const [id, expected] of [
      [legacy, '2024-02-29 23:59'],
      [emptyPhone, '2026-10-21 00:00'],
      [timeOnly, null],
    ]) {
      const [row] = await db.query<{ received_at: string | null }[]>(
        `SELECT to_char(received_at,'YYYY-MM-DD HH24:MI') AS received_at FROM website_inquiries WHERE id=$1`,
        [id],
      );
      assert.equal(row.received_at, expected);
    }
    assert.equal((await db.runMigrations()).length, 0);
    const columns = await db.query<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='website_inquiries'`,
    );
    for (const old of [
      'phone',
      'email',
      'arrival_time',
      'departure_time',
      'received_date',
      'received_time',
    ])
      assert(!columns.some((c) => c.column_name === old));
    assert.deepEqual(
      (
        await db.query<{ snapshot: unknown }[]>(
          'SELECT snapshot FROM website_quotations WHERE id=$1',
          [quote],
        )
      )[0].snapshot,
      snapshot,
    );
    assert.deepEqual(
      await db.query(
        'SELECT arrival_time,departure_time FROM website_itineraries WHERE id=$1',
        [itinerary],
      ),
      [{ arrival_time: '11:00', departure_time: '21:00' }],
    );
    await assert.rejects(
      db.query(
        `UPDATE website_inquiries SET received_at='2026-02-30 24:00' WHERE id=$1`,
        [legacy],
      ),
      /out of range/,
    );
    const visitSource = await source(names[0]).initialize();
    const visitId = randomUUID(),
      outsideId = randomUUID();
    await admin.query(
      "CREATE ROLE visits_test_reader LOGIN PASSWORD 'readonly-test'",
    );
    await visitSource.query(
      'GRANT USAGE ON SCHEMA public TO visits_test_reader; GRANT SELECT ON lynx_visits TO visits_test_reader',
    );
    for (const [id, ref, created] of [
      [visitId, 'LX-K8GQ76RHK4', '2026-10-20T16:00:00Z'],
      [outsideId, 'LX-OUTSIDE', '2026-10-20T15:59:59Z'],
    ]) {
      await visitSource.query(
        `INSERT INTO lynx_visits(id,whatsapp_reference,website_inquiry_id,contract_version,first_landing_page,external_referrer,utm_source,created_at_utc,expires_at_utc,payload_fingerprint) VALUES($1,$2,'WEB-42','test','https://lynxtour.cn/tour','https://example.test/','=formula',$3,$3::timestamptz+interval '180 days',repeat('a',64))`,
        [id, ref, created],
      );
    }
    await visitSource.destroy();
    const module = await Test.createTestingModule({
      controllers: [WebsiteController, WebsiteVisitsController],
      providers: [
        WebsiteService,
        WebsiteVisitsService,
        WebsiteVisitsReader,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            LYNX_VISITS_DB_HOST: '127.0.0.1',
            LYNX_VISITS_DB_PORT: 55451,
            LYNX_VISITS_DB_NAME: names[0],
            LYNX_VISITS_DB_USER: 'visits_test_reader',
            LYNX_VISITS_DB_PASSWORD: 'readonly-test',
          }),
        },
        { provide: DataSource, useValue: db },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.use((req: Request, _res: unknown, next: () => void) => {
      req.user = actors[String(req.headers['x-test-actor'])];
      next();
    });
    app.useGlobalGuards(new PermissionsGuard(app.get(Reflector)));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: createValidationException,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const old = await call('web', 'GET', `inquiries/${legacy}`);
    assert.equal(old.contactInfo, 'legacy-phone');
    assert.equal(old.code, before.code);
    assert.equal(old.updatedAt, before.updated_at.toISOString());
    assert.equal(old.receivedAt, '2024-02-29 23:59');
    assert.equal(
      (await call('web', 'GET', `inquiries/${emptyPhone}`)).contactInfo,
      '',
    );
    const input = {
      countryItemId: country.id,
      customerName: 'Test',
      plannedDays: 1,
      requirements: 'Test requirement',
    };
    const fields = {
      contactInfo: '任意文字 / not an email @ +86',
      receivedAt: '2024-02-29 23:59',
      contactChannel: 'WhatsApp / 邮件',
      whatsappSourceId: 'WA-free-text',
      websiteInquiryNo: 'external-123',
      landingPage: '/known-page',
      acquisitionSource: '朋友推荐',
    };
    const created = await call(
      'web',
      'POST',
      'inquiries',
      { ...input, ...fields },
      201,
    );
    for (const [key, value] of Object.entries(fields))
      assert.equal(created[key as keyof WebsiteInquiry], value);
    for (const key of ['phone', 'email', 'arrivalTime', 'departureTime'])
      assert(!(key in created));
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date(created.createdAt))
      .replaceAll('-', '')
      .slice(2);
    assert.equal(created.code, `KMLX-WIQ-${date}AS1-MYS`);
    const lx = await call('linxi', 'POST', 'inquiries', input, 201);
    assert.equal(lx.code, `KMLX-WIQ-${date}AS2-MYS`);
    assert.equal(lx.businessUnit, 'linxi');
    assert.equal(lx.contactInfo, '');
    assert.equal(lx.receivedAt, null);
    const list = await call<{ list: WebsiteInquiry[]; total: number }>(
      'web',
      'GET',
      'inquiries?keyword=Test',
    );
    assert.equal(list.total, 1);
    assert.equal(list.list[0].contactInfo, fields.contactInfo);
    await call('linxi', 'GET', `inquiries/${created.id}`, undefined, 404);
    await call('other', 'GET', `inquiries/${created.id}`, undefined, 404);
    await call(
      'readonly',
      'POST',
      'inquiries',
      { ...input, businessUnit: 'website', ownerId: owner },
      403,
    );
    await call('shengxu', 'GET', 'inquiries', undefined, 403);
    await call('noCode', 'POST', 'inquiries', input, 400);
    for (const patch of [
      { phone: '' },
      { email: '' },
      { arrivalTime: '' },
      { departureTime: '' },
      { updatedAt: created.updatedAt },
      { code: 'client' },
      { receivedAt: '2026-02-30 12:00' },
      { receivedAt: '2026-02-28 24:00' },
      { receivedAt: '2026-02-28 9:01' },
      { receivedDate: null },
      { receivedTime: '' },
      { contactInfo: null },
      { contactInfo: 'x'.repeat(501) },
      { contactChannel: 'x'.repeat(101) },
      { whatsappSourceId: 'x'.repeat(201) },
      { websiteInquiryNo: 'x'.repeat(201) },
      { landingPage: 'x'.repeat(2049) },
      { acquisitionSource: 'x'.repeat(2049) },
    ])
      await call('web', 'POST', 'inquiries', { ...input, ...patch }, 400);
    await call(
      'web',
      'PUT',
      `inquiries/${created.id}`,
      { ...input, version: created.version, phone: '' },
      400,
    );
    const changed = await call('web', 'PUT', `inquiries/${created.id}`, {
      ...input,
      ...fields,
      contactInfo: 'new contact',
      receivedAt: '2026-10-21 00:00',
      countryItemId: unknown.id,
      version: created.version,
    });
    assert.equal(changed.code, created.code);
    assert.equal(changed.countryCode, 'UNKNOWN');
    assert.equal(changed.contactInfo, 'new contact');
    assert.equal(changed.version, 2);
    assert(changed.updatedAt > created.updatedAt);
    await call(
      'web',
      'PUT',
      `inquiries/${created.id}`,
      { ...input, version: created.version },
      409,
    );
    const cleared = await call('web', 'PUT', `inquiries/${created.id}`, {
      ...input,
      version: changed.version,
    });
    for (const key of Object.keys(fields))
      assert.equal(
        cleared[key as keyof WebsiteInquiry],
        key === 'receivedAt' ? null : '',
      );
    const transferred = await call(
      'root',
      'POST',
      `inquiries/${created.id}/transfer`,
      { version: cleared.version, ownerId: actors.other.id, reason: 'test' },
      201,
    );
    assert.equal(transferred.code, created.code);
    assert.equal(transferred.ownerId, actors.other.id);
    const plan = await call<WebsiteItinerary>(
      'linxi',
      'POST',
      `inquiries/${lx.id}/itineraries`,
      {
        title: 'Draft',
        duration: 1,
        configVersion: 1,
        inquiryVersion: lx.version,
        arrivalTime: '12:00',
        departureTime: '19:00',
      },
      201,
    );
    assert.equal(plan.arrivalTime, '12:00');
    assert.equal(plan.departureTime, '19:00');
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () =>
        call('web', 'POST', 'inquiries', input, 201),
      ),
    );
    assert.equal(new Set(concurrent.map((r) => r.code)).size, 8);
    const digit = await call('digits', 'POST', 'inquiries', input, 201);
    assert.equal(digit.code, `KMLX-WIQ-${date}AS11-MYS`);
    await db.query('DELETE FROM website_logs WHERE inquiry_id=$1', [digit.id]);
    await db.query('DELETE FROM website_inquiries WHERE id=$1', [digit.id]);
    const collision = await call('web', 'POST', 'inquiries', input, 201);
    assert.equal(collision.code, `KMLX-WIQ-${date}AS(1)11-MYS`);
    const withUnknown = await call(
      'web',
      'POST',
      'inquiries',
      { ...input, countryItemId: unknown.id, receivedAt: null },
      201,
    );
    assert.match(withUnknown.code, /-UNKNOWN$/);
    assert.equal(withUnknown.receivedAt, null);
    type VisitList = {
      total: number;
      list: Array<{
        id: string;
        converted: boolean;
        inquiry: { id: string; code: string } | null;
      }>;
    };
    const visitsPath = '/ledgers/website-visits';
    const visits = await call<VisitList>(
      'web',
      'GET',
      visitsPath + '?start=2026-10-21&end=2026-10-21',
    );
    assert.equal(visits.total, 1);
    assert.equal(visits.list[0].id, visitId);
    assert.equal(visits.list[0].converted, false);
    await call('linxi', 'GET', visitsPath, undefined, 403);
    await call('shengxu', 'GET', visitsPath, undefined, 403);
    await call(
      'readonly',
      'GET',
      `${visitsPath}/${visitId}/inquiry-draft`,
      undefined,
      403,
    );
    await call('web', 'GET', visitsPath + '?start=2026-10-21', undefined, 400);
    await call(
      'web',
      'GET',
      visitsPath + '?start=2026-10-22&end=2026-10-21',
      undefined,
      400,
    );
    const prefill = await call<Record<string, unknown>>(
      'web',
      'GET',
      `${visitsPath}/${visitId}/inquiry-draft`,
    );
    assert.equal(prefill.whatsappSourceId, 'LX-K8GQ76RHK4');
    assert.equal(prefill.websiteInquiryNo, 'WEB-42');
    assert.equal(prefill.receivedAt, '2026-10-21 00:00');
    assert.equal(prefill.landingPage, 'https://lynxtour.cn/tour');
    assert.equal(prefill.acquisitionSource, '=formula');
    assert.equal(prefill.contactChannel, 'WhatsApp');
    assert(!('customerName' in prefill));
    await call(
      'web',
      'POST',
      `${visitsPath}/${visitId}/inquiry`,
      { ...prefill },
      400,
    );
    await call(
      'web',
      'POST',
      `${visitsPath}/${visitId}/inquiry`,
      { ...input, ...prefill, businessUnit: 'linxi' },
      403,
    );
    const answers = await Promise.all(
      Array.from({ length: 2 }, () =>
        fetch(`${base}/api${visitsPath}/${visitId}/inquiry`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-test-actor': 'web',
          },
          body: JSON.stringify({ ...input, ...prefill }),
        }),
      ),
    );
    assert.deepEqual(answers.map((r) => r.status).sort(), [201, 409]);
    requests += 2;
    const generated = (
      await call<VisitList>('web', 'GET', visitsPath + '?keyword=K8GQ')
    ).list[0];
    assert.equal(generated.converted, true);
    assert(generated.inquiry?.id);
    assert.equal(
      (await call('web', 'GET', `inquiries/${generated.inquiry.id}`))
        .receivedAt,
      '2026-10-21 00:00',
    );
    const hidden = (
      await call<VisitList>('other', 'GET', visitsPath + '?keyword=K8GQ')
    ).list[0];
    assert.equal(hidden.converted, true);
    assert.equal(hidden.inquiry, null);
    await call(
      'web',
      'GET',
      `${visitsPath}/${visitId}/inquiry-draft`,
      undefined,
      409,
    );
    await call(
      'web',
      'POST',
      `${visitsPath}/${visitId}/inquiry`,
      { ...input, ...prefill },
      409,
    );
    await call(
      'web',
      'GET',
      `${visitsPath}/${randomUUID()}/inquiry-draft`,
      undefined,
      404,
    );
    const csv = await fetch(
      `${base}/api${visitsPath}/export?start=2026-10-21&end=2026-10-21`,
      { headers: { 'x-test-actor': 'web' } },
    );
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    const csvText = await csv.text();
    assert(csvText.includes('LX-K8GQ76RHK4'));
    assert(!csvText.includes('LX-OUTSIDE'));
    assert(csvText.includes("'="));
    assert(!csvText.includes('converted'));
    await call('web', 'GET', visitsPath + '/export', undefined, 400);
    await call(
      'linxi',
      'GET',
      visitsPath + '/export?start=2026-10-21&end=2026-10-21',
      undefined,
      403,
    );
    const sourceConnection = new DataSource({
      ...connection,
      database: names[0],
      username: 'visits_test_reader',
      password: 'readonly-test',
    });
    await sourceConnection.initialize();
    assert.equal(
      (
        await sourceConnection.query<{ total: string }[]>(
          'SELECT count(*)::text total FROM lynx_visits',
        )
      )[0].total,
      '2',
    );
    await assert.rejects(
      sourceConnection.query('DELETE FROM lynx_visits'),
      /permission denied/,
    );
    await sourceConnection.destroy();
    console.log(
      `PASS: ${requests} HTTP checks; empty + repeat migrations, legacy upgrade, phone-only conversion, frozen snapshot and itinerary preservation, fields roundtrip/clear, validation, versions, scope, numbering concurrency/collision/deletion; cross-database read-only visit source, Beijing range/CSV, draft mapping, transactional conversion and visibility.`,
    );
  } finally {
    if (app) await app.close();
    if (db?.isInitialized) await db.destroy();
    for (const name of names)
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.query('DROP ROLE IF EXISTS visits_test_reader');
    await admin.destroy();
  }
}
run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
