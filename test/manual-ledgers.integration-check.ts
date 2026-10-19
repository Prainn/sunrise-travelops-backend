/** Only disposable localhost PostgreSQL: never reads .env or business DB settings. */
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
import { ShengxuLedgersController } from '../src/ledgers/shengxu-ledgers.controller';
import { ShengxuLedgersService } from '../src/ledgers/shengxu-ledgers.service';
import { DirectLedgersController } from '../src/ledgers/direct-ledgers.controller';
import { DirectLedgersService } from '../src/ledgers/direct-ledgers.service';

const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55449,
  username: 'postgres',
  password: 'isolated-ledger-test',
};
const admin = new DataSource({ ...connection, database: 'postgres' });
const names = [`ledgers_empty_${Date.now()}`, `ledgers_upgrade_${Date.now()}`];
const source = (database: string) =>
  new DataSource({
    ...connection,
    database,
    synchronize: false,
    migrations: ['src/migrations/*.ts'],
    entities: ['src/**/*.entity.ts'],
  });
interface Ledger {
  id: string;
  version: number;
  orderNo: string;
  businessUnit: string;
  receivingAccountName: string;
  creatorId: string;
  reviewedAt: string | null;
  operated: boolean;
  operatedAt: string | null;
  agencyName: string;
  capabilities: {
    canEdit: boolean;
    canDelete: boolean;
    canReview: boolean;
    canOperate: boolean;
    canChangeStatus: boolean;
  };
}
interface Page {
  list: Ledger[];
  total: number;
  page: number;
  pageSize: number;
}
const actors: Record<string, AuthenticatedUser> = {};
let db: DataSource;
let app: INestApplication | undefined;
let base = '';
let assertions = 0;
async function call<T = Ledger>(
  actor: string,
  method: string,
  path: string,
  body?: unknown,
  expected: number | number[] = 200,
) {
  const response = await fetch(`${base}/api/ledgers/${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-actor': actor },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.ok(
    (Array.isArray(expected) ? expected : [expected]).includes(response.status),
    `${actor} ${method} ${path}: ${response.status} ${text}`,
  );
  assertions++;
  return text
    ? (JSON.parse(text) as { data: T; code: string }).data
    : (undefined as T);
}
async function actor(
  name: string,
  scope: AuthenticatedUser['scope'],
  role = 'COORDINATOR',
) {
  const id = randomUUID(),
    identityId = randomUUID();
  await db.query(
    `INSERT INTO users(id,username,password_hash,nickname,english_name) VALUES($1,$2,'test-only',$2,$2)`,
    [id, name],
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
async function agency(name: string, owner: string, unit = 'shengxu') {
  const id = randomUUID(),
    contactId = randomUUID();
  await db.query(
    `INSERT INTO resource_agencies(id,code,name,business_unit,coordinator_id,country_or_region,city) VALUES($1,next_business_code('AGY'),$2,$3,$4,'中国','杭州')`,
    [id, name, unit, owner],
  );
  await db.query(
    'INSERT INTO resource_agency_contacts(id,agency_id,name,name_key) VALUES($1,$2,$3,$3)',
    [contactId, id, name],
  );
  return { agencyId: id, contactId };
}
async function run() {
  await admin.initialize();
  try {
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
      ...all.filter((m) => m.name !== 'CreateManualLedgers1792454400000'),
    );
    await db.runMigrations();
    const sx1 = await actor('sx1', 'shengxu'),
      sx2 = await actor('sx2', 'shengxu');
    await actor('sxManager', 'shengxu', 'BUSINESS_MANAGER');
    const lx1 = await actor('lx1', 'linxi'),
      lx2 = await actor('lx2', 'linxi');
    await actor('lx3', 'linxi');
    await actor('lxManager', 'linxi', 'BUSINESS_MANAGER');
    const web = await actor('web', 'website');
    for (const role of ['ROOT', 'ADMIN', 'EXECUTIVE'])
      await actor(role, 'headquarters', role);
    await actor('resource', 'linxi', 'RESOURCE_MANAGER');
    const a1 = await agency('agency1', sx1),
      a2 = await agency('agency2', sx2),
      a3 = await agency('agency3', sx1),
      foreign = await agency('foreign', lx1, 'linxi');
    await db.query(
      "UPDATE role_menu_configs SET menu_keys=ARRAY['tours','inquiries'] WHERE role_id=(SELECT id FROM roles WHERE code='COORDINATOR')",
    );
    db.migrations.splice(0, db.migrations.length, ...all);
    assert.equal((await db.runMigrations()).length, 1);
    assert.equal((await db.runMigrations()).length, 0);
    const [preserved] = await db.query<{ count: string }[]>(
      'SELECT count(*) FROM resource_agencies WHERE id=ANY($1::uuid[])',
      [[a1.agencyId, a2.agencyId, a3.agencyId, foreign.agencyId]],
    );
    assert.equal(preserved.count, '4');
    const [menu] = await db.query<{ keys: string[] }[]>(
      "SELECT menu_keys AS keys FROM role_menu_configs WHERE role_id=(SELECT id FROM roles WHERE code='COORDINATOR')",
    );
    assert.deepEqual(menu.keys.sort(), [
      'direct-ledger',
      'inquiries',
      'shengxu-ledger',
      'tours',
    ]);
    const module = await Test.createTestingModule({
      controllers: [ShengxuLedgersController, DirectLedgersController],
      providers: [
        ShengxuLedgersService,
        DirectLedgersService,
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

    const sx = {
      recordDate: '2026-10-19',
      ...a1,
      quotedGroups: 2,
      convertedGroups: 0,
    };
    const parallel = await Promise.all([
      call('sx1', 'POST', 'shengxu', sx, [201, 409]),
      call('sx1', 'POST', 'shengxu', sx, [201, 409]),
    ]);
    assert.equal(parallel.filter(Boolean).length, 1);
    let list = await call<Page>('sx2', 'GET', 'shengxu');
    assert.equal(list.total, 1);
    let s = list.list[0];
    assert.equal(s.capabilities.canEdit, false);
    await call(
      'sx2',
      'PUT',
      `shengxu/${s.id}`,
      { ...sx, version: s.version },
      403,
    );
    await call(
      'sx1',
      'POST',
      'shengxu',
      { ...sx, ...a2, recordDate: '2026-10-20' },
      400,
    );
    await call(
      'sx1',
      'POST',
      'shengxu',
      { ...sx, ...foreign, recordDate: '2026-10-20' },
      400,
    );
    await call(
      'sx1',
      'POST',
      'shengxu',
      { ...sx, contactId: a2.contactId, recordDate: '2026-10-20' },
      400,
    );
    await call(
      'sx1',
      'POST',
      'shengxu',
      { ...sx, recordDate: '2026-02-30' },
      400,
    );
    await call(
      'sx1',
      'POST',
      'shengxu',
      { ...sx, recordDate: '2026-10-20', quoteSent: null },
      400,
    );
    await call('sx1', 'POST', 'shengxu', { ...sx, creatorId: sx2 }, 400);
    const s2 = await call(
      'sx1',
      'POST',
      'shengxu',
      { ...sx, recordDate: '2026-10-20' },
      201,
    );
    await call(
      'sx1',
      'PUT',
      `shengxu/${s2.id}`,
      { ...sx, version: s2.version },
      409,
    );
    await call(
      'sxManager',
      'PUT',
      `shengxu/${s.id}`,
      { ...sx, ...a2, version: s.version },
      400,
    );
    s = await call('sxManager', 'PUT', `shengxu/${s.id}`, {
      ...sx,
      convertedGroups: 1,
      version: s.version,
    });
    await call(
      'sx1',
      'DELETE',
      `shengxu/${s.id}?version=${s.version}`,
      undefined,
      409,
    );
    await call('sx1', 'PUT', `shengxu/${s.id}`, { ...sx, version: 1 }, 409);
    await db.query(
      "UPDATE resource_agencies SET status='disabled',name='changed' WHERE id=$1",
      [a1.agencyId],
    );
    s = await call('sx1', 'PUT', `shengxu/${s.id}`, {
      ...sx,
      convertedGroups: 1,
      itinerary: 'historic',
      version: s.version,
    });
    assert.equal(s.agencyName, 'agency1');
    await call('sx1', 'DELETE', `shengxu/${s2.id}?version=1`, undefined, 204);
    const options = await call<Page>('sx1', 'GET', 'shengxu/agencies');
    assert.equal(options.total, 1);
    assert.equal(options.list[0].id, a3.agencyId);
    await call(
      'sx2',
      'GET',
      `shengxu/agencies?ledgerId=${s.id}`,
      undefined,
      403,
    );
    const contacts = await call<Page>(
      'sx1',
      'GET',
      `shengxu/agencies/${a1.agencyId}/contacts?ledgerId=${s.id}`,
    );
    assert.equal(contacts.total, 1);
    await call('lx1', 'GET', 'shengxu', undefined, 403);
    await call('sx1', 'GET', 'direct', undefined, 403);
    await call('resource', 'GET', 'direct', undefined, 403);

    const direct = {
      receivedDate: '2026-10-19',
      source: '携程123',
      receivingAccountId: lx1,
      operatorId: lx2,
    };
    let d = await call('lx1', 'POST', 'direct', direct, 201);
    assert.match(d.orderNo, /^DL-\d{10}$/);
    assert.equal(d.creatorId, lx1);
    list = await call<Page>('lx3', 'GET', 'direct');
    assert.equal(list.total, 1);
    assert.equal(list.list[0].capabilities.canEdit, false);
    await call('lx3', 'PUT', `direct/${d.id}`, { ...direct, version: 1 }, 403);
    await call('web', 'GET', `direct/${d.id}`, undefined, 404);
    await call('web', 'PUT', `direct/${d.id}`, { ...direct, version: 1 }, 404);
    await call('web', 'DELETE', `direct/${d.id}?version=1`, undefined, 404);
    await call('lx1', 'GET', 'direct?businessUnit=website', undefined, 403);
    await call('lx1', 'POST', 'direct', { ...direct, operatorId: web }, 400);
    await call(
      'lx1',
      'POST',
      'direct',
      { ...direct, receivingAccountId: web },
      400,
    );
    await call(
      'lx1',
      'POST',
      'direct',
      { ...direct, receivingAccountId: null },
      400,
    );
    await call(
      'lx1',
      'POST',
      'direct',
      { ...direct, reviewedAt: '2026-10-19' },
      400,
    );
    await call('lx1', 'POST', 'direct', { ...direct, source: '  ' }, 400);
    await call('lx1', 'POST', 'direct', { ...direct, complaint: 'false' }, 400);
    await call(
      'lx1',
      'POST',
      `direct/${d.id}/review`,
      { version: d.version },
      403,
    );
    await call(
      'lx2',
      'PUT',
      `direct/${d.id}/operation`,
      { version: d.version, operated: true },
      409,
    );
    await call(
      'lx2',
      'PUT',
      `direct/${d.id}`,
      { ...direct, version: d.version, orderStatus: 'converted' },
      403,
    );
    d = await call('lx2', 'PUT', `direct/${d.id}`, {
      ...direct,
      version: d.version,
      remark: 'operator edited',
    });
    const oldVersion = d.version;
    const edits = await Promise.all([
      call(
        'lx1',
        'PUT',
        `direct/${d.id}`,
        { ...direct, version: d.version, orderStatus: 'converted' },
        [200, 409],
      ),
      call(
        'lxManager',
        'POST',
        `direct/${d.id}/review`,
        { version: d.version },
        [200, 409],
      ),
    ]);
    assert.equal(edits.filter(Boolean).length, 1);
    d = await call('lx1', 'GET', `direct/${d.id}`);
    assert.equal(d.version, oldVersion + 1);
    // Use a fresh record for deterministic status-lock scenarios.
    d = await call(
      'lx1',
      'POST',
      'direct',
      { ...direct, orderStatus: 'converted' },
      201,
    );
    await call(
      'lxManager',
      'PUT',
      `direct/${d.id}/operation`,
      { version: d.version, operated: true },
      403,
    );
    d = await call('lx2', 'PUT', `direct/${d.id}/operation`, {
      version: d.version,
      operated: true,
    });
    d = await call('lx2', 'PUT', `direct/${d.id}/operation`, {
      version: d.version,
      operated: false,
    });
    assert.ok(d.operatedAt);
    await call(
      'lx1',
      'PUT',
      `direct/${d.id}`,
      { ...direct, version: d.version },
      409,
    );
    d = await call('lxManager', 'POST', `direct/${d.id}/review`, {
      version: d.version,
    });
    assert.ok(d.reviewedAt);
    await call(
      'lxManager',
      'PUT',
      `direct/${d.id}`,
      { ...direct, orderStatus: 'converted', version: d.version },
      409,
    );
    d = await call('lx2', 'PUT', `direct/${d.id}/operation`, {
      version: d.version,
      operated: true,
    });
    await call(
      'lx2',
      'DELETE',
      `direct/${d.id}?version=${d.version}`,
      undefined,
      409,
    );
    let pending = await call('lx1', 'POST', 'direct', direct, 201);
    pending = await call('lxManager', 'POST', `direct/${pending.id}/review`, {
      version: pending.version,
    });
    await call(
      'lx1',
      'DELETE',
      `direct/${pending.id}?version=${pending.version}`,
      undefined,
      409,
    );
    const deletable = await call('lx1', 'POST', 'direct', direct, 201);
    await call(
      'lx2',
      'DELETE',
      `direct/${deletable.id}?version=${deletable.version}`,
      undefined,
      204,
    );
    await call('lx1', 'GET', `direct/${deletable.id}`, undefined, 404);
    const w = await call(
      'web',
      'POST',
      'direct',
      { receivedDate: '2026-10-19', source: '客户', operatorId: web },
      201,
    );
    assert.equal(w.receivingAccountName, '独立站');
    assert.equal(w.businessUnit, 'website');
    await call(
      'web',
      'POST',
      'direct',
      {
        receivedDate: '2026-10-19',
        source: '客户',
        operatorId: web,
        receivingAccountId: web,
      },
      400,
    );
    const people = await call<Page>(
      'lx1',
      'GET',
      'direct/operators?pageSize=1',
    );
    assert.equal(people.list.length, 1);
    assert.equal(people.total, 3);
    const filtered = await call<Page>(
      'lx1',
      'GET',
      'direct?keyword=does-not-exist',
    );
    assert.equal(filtered.total, 0);
    for (const role of ['ROOT', 'ADMIN', 'EXECUTIVE']) {
      await call(role, 'GET', 'shengxu');
      await call(role, 'GET', 'direct', undefined, 400);
      const p = await call<Page>(role, 'GET', 'direct?businessUnit=website');
      assert.equal(p.total, 1);
      assert.equal(p.list[0].capabilities.canEdit, false);
      await call(role, 'GET', `direct/${d.id}`);
      await call(role, 'POST', 'direct', direct, 403);
      await call(role, 'POST', 'shengxu', sx, 403);
      await call(
        role,
        'PUT',
        `direct/${d.id}`,
        { ...direct, version: d.version },
        403,
      );
      await call(
        role,
        'DELETE',
        `direct/${d.id}?version=${d.version}`,
        undefined,
        403,
      );
      await call(
        role,
        'POST',
        `direct/${d.id}/review`,
        { version: d.version },
        403,
      );
      await call(
        role,
        'PUT',
        `direct/${d.id}/operation`,
        { version: d.version, operated: true },
        403,
      );
    }
    console.log(
      `Manual ledger checks passed: empty/repeated migrations, representative upgrade preservation, ${assertions} HTTP status assertions, scope/ownership/options/status/version/concurrency.`,
    );
  } finally {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
    for (const name of names)
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.destroy();
  }
}
void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
