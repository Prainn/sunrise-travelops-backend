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
  const response = await fetch(`${base}/api/website/${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-actor': actor },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await response.json()) as { code: string; data: T };
  assert.equal(
    response.status,
    expected,
    `${actor} ${method} ${path}: ${JSON.stringify(payload)}`,
  );
  if (expected === 400) assert.equal(payload.code, 'VALIDATION_ERROR');
  if (expected === 409) assert.equal(payload.code, 'INQUIRY_VERSION_CONFLICT');
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
          (m.name ?? m.constructor.name) !==
          'UpdateWebsiteInquiryFields1792886400000',
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
    db.migrations.splice(0, db.migrations.length, ...all);
    assert.equal((await db.runMigrations()).length, 1);
    assert.equal((await db.runMigrations()).length, 0);
    const columns = await db.query<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='website_inquiries'`,
    );
    for (const old of ['phone', 'email', 'arrival_time', 'departure_time'])
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
        `UPDATE website_inquiries SET received_time='24:00' WHERE id=$1`,
        [legacy],
      ),
      /check constraint/,
    );
    const module = await Test.createTestingModule({
      controllers: [WebsiteController],
      providers: [WebsiteService, { provide: DataSource, useValue: db }],
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
    assert.equal(old.receivedDate, null);
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
      receivedDate: '2024-02-29',
      receivedTime: '23:59',
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
    assert.equal(lx.receivedTime, '');
    assert.equal(lx.receivedDate, null);
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
      { receivedDate: '2026-02-30' },
      { receivedTime: '24:00' },
      { receivedTime: '9:01' },
      { receivedTime: null },
      { contactInfo: null },
      { contactInfo: 'x'.repeat(501) },
      { contactChannel: 'x'.repeat(101) },
      { whatsappSourceId: 'x'.repeat(201) },
      { websiteInquiryNo: 'x'.repeat(201) },
      { landingPage: 'x'.repeat(2001) },
      { acquisitionSource: 'x'.repeat(201) },
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
      receivedTime: '00:00',
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
        key === 'receivedDate' ? null : '',
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
      { ...input, countryItemId: unknown.id, receivedTime: '00:00' },
      201,
    );
    assert.match(withUnknown.code, /-UNKNOWN$/);
    assert.equal(withUnknown.receivedDate, null);
    console.log(
      `PASS: ${requests} HTTP checks; empty + repeat migrations, legacy upgrade, phone-only conversion, frozen snapshot and itinerary preservation, fields roundtrip/clear, validation, versions, scope, numbering concurrency/collision/deletion.`,
    );
  } finally {
    if (app) await app.close();
    if (db?.isInitialized) await db.destroy();
    for (const name of names)
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.destroy();
  }
}
run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
