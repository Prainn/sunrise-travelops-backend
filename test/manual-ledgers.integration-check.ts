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

import { ToursController } from '../src/tours/tours.controller';
import { ToursService } from '../src/tours/tours.service';

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
  creatorName: string;
  updatedBy: string;
  workflowStatus: 'pending_confirmation' | 'pending_operation' | 'operated';
  orderStatus: string;
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
  const response = await fetch(
    `${base}/api${path.startsWith('/') ? path : `/ledgers/${path}`}`,
    {
      method,
      headers: { 'content-type': 'application/json', 'x-test-actor': actor },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
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
      ...all.filter(
        (m) =>
          ![
            'AddTourAgencyReference1792800000000',
            'CreateManualLedgers1792454400000',
            'UpdateDirectLedgerWorkflow1792713600000',
          ].includes(m.name!),
      ),
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
    db.migrations.splice(
      0,
      db.migrations.length,
      ...all.filter(
        (m) =>
          ![
            'UpdateDirectLedgerWorkflow1792713600000',
            'AddTourAgencyReference1792800000000',
          ].includes(m.name!),
      ),
    );
    assert.equal((await db.runMigrations()).length, 1);
    const [legacy] = await db.query<{ id: string }[]>(
      `INSERT INTO direct_ledgers(business_unit,received_date,source,creator_id,creator_name,receiving_account_id,receiving_account_name,operator_id,operator_name,updated_by,order_status,loss,reviewed_at,reviewed_by,operated,operated_at)
       VALUES('linxi','2026-10-19','legacy',$1,'Designer',$1,'Account',$2,'Operator',$1,'converted',true,now(),$1,true,now()) RETURNING id`,
      [lx1, lx2],
    );
    const before = await db.query<Record<string, unknown>[]>(
      'SELECT * FROM direct_ledgers WHERE id=$1',
      [legacy.id],
    );
    const [legacyTour] = await db.query<{ id: string }[]>(
      `INSERT INTO tours(tour_no,source_module,business_unit,agency_name,days,start_date,pickup_at,drop_at,occupy_from,occupy_to,country_item_id,country_code,country_name,creator_id,creator_tour_code,creator_sequence,collect_coordinator_id,collect_coordinator_name,operator_id,operator_name,adults,children,leaders,schedule_mode,itinerary_summary)
       SELECT 'LEGACY-AGENCY','manual','shengxu','历史自由名称',1,'2026-10-20','2026-10-20','2026-10-20','2026-10-20','2026-10-20',i.id,i.code,i.name,$1,'OLD',1,$1,'Old owner',$1,'Old operator',0,0,0,'manual','历史行程'
       FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' LIMIT 1 RETURNING id`,
      [sx1],
    );
    const [legacyTourBefore] = await db.query<Record<string, unknown>[]>(
      'SELECT * FROM tours WHERE id=$1',
      [legacyTour.id],
    );
    db.migrations.splice(0, db.migrations.length, ...all);
    assert.equal((await db.runMigrations()).length, 2);
    const [legacyTourAfter] = await db.query<Record<string, unknown>[]>(
      'SELECT * FROM tours WHERE id=$1',
      [legacyTour.id],
    );
    assert.deepEqual(legacyTourAfter, { ...legacyTourBefore, agency_id: null });
    await db.query('DELETE FROM tours WHERE id=$1', [legacyTour.id]);
    assert.deepEqual(
      await db.query('SELECT * FROM direct_ledgers WHERE id=$1', [legacy.id]),
      before,
    );
    // The new workflow allows operation without conversion, retaining all other CHECKs.
    await db.query(
      "UPDATE direct_ledgers SET order_status='unconverted' WHERE id=$1",
      [legacy.id],
    );
    await assert.rejects(
      db.query('UPDATE direct_ledgers SET operated_at=NULL WHERE id=$1', [
        legacy.id,
      ]),
    );
    await assert.rejects(
      db.query('UPDATE direct_ledgers SET reviewed_by=NULL WHERE id=$1', [
        legacy.id,
      ]),
    );
    await db.query('DELETE FROM direct_ledgers WHERE id=$1', [legacy.id]);
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
      controllers: [
        ShengxuLedgersController,
        DirectLedgersController,
        ToursController,
      ],
      providers: [
        ToursService,
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
      loss: true,
    };
    let d = await call('lx1', 'POST', 'direct', direct, 201);
    assert.equal(d.workflowStatus, 'pending_confirmation');
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
      { version: d.version },
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
    // No-loss records can be operated without conversion or manager confirmation.
    d = await call('lx1', 'POST', 'direct', { ...direct, loss: false }, 201);
    assert.equal(d.workflowStatus, 'pending_operation');
    assert.equal(d.orderStatus, 'unconverted');
    await call(
      'lxManager',
      'POST',
      `direct/${d.id}/review`,
      { version: d.version },
      409,
    );
    await call(
      'lxManager',
      'PUT',
      `direct/${d.id}/operation`,
      { version: d.version },
      403,
    );
    const operations = await Promise.all([
      call(
        'lx2',
        'PUT',
        `direct/${d.id}/operation`,
        { version: d.version },
        [200, 409],
      ),
      call(
        'lx2',
        'PUT',
        `direct/${d.id}/operation`,
        { version: d.version },
        [200, 409],
      ),
    ]);
    assert.equal(operations.filter(Boolean).length, 1);
    d = await call('lx2', 'GET', `direct/${d.id}`);
    assert.equal(d.workflowStatus, 'operated');
    assert.equal(d.orderStatus, 'unconverted');
    assert.ok(d.operatedAt);
    assert.equal(d.capabilities.canEdit, false);
    assert.equal(d.capabilities.canOperate, false);
    await call(
      'lx2',
      'PUT',
      `direct/${d.id}/operation`,
      { version: d.version },
      409,
    );
    await call(
      'lx2',
      'PUT',
      `direct/${d.id}/operation`,
      { version: d.version, operated: false },
      400,
    );
    for (const who of ['lx1', 'lx2', 'lxManager'])
      await call(
        who,
        'PUT',
        `direct/${d.id}`,
        { ...direct, version: d.version },
        409,
      );
    await call(
      'lx2',
      'DELETE',
      `direct/${d.id}?version=${d.version}`,
      undefined,
      409,
    );

    // A loss needs manager confirmation, then only its assigned operator may complete it.
    let pending = await call('lx1', 'POST', 'direct', direct, 201);
    assert.equal(pending.workflowStatus, 'pending_confirmation');
    await call(
      'lx2',
      'PUT',
      `direct/${pending.id}/operation`,
      { version: pending.version },
      409,
    );
    await call(
      'web',
      'POST',
      `direct/${pending.id}/review`,
      { version: pending.version },
      403,
    );
    pending = await call('lxManager', 'POST', `direct/${pending.id}/review`, {
      version: pending.version,
    });
    assert.equal(pending.workflowStatus, 'pending_operation');
    assert.ok(pending.reviewedAt);
    assert.equal(pending.capabilities.canEdit, false);
    await call(
      'lxManager',
      'PUT',
      `direct/${pending.id}`,
      { ...direct, version: pending.version, loss: false },
      409,
    );
    await call(
      'lxManager',
      'POST',
      `direct/${pending.id}/review`,
      { version: pending.version },
      409,
    );
    await call(
      'lx1',
      'DELETE',
      `direct/${pending.id}?version=${pending.version}`,
      undefined,
      409,
    );
    pending = await call('lx2', 'PUT', `direct/${pending.id}/operation`, {
      version: pending.version,
    });
    assert.equal(pending.workflowStatus, 'operated');
    const operatedPage = await call<Page>(
      'lx1',
      'GET',
      'direct?workflowStatus=operated',
    );
    assert.ok(operatedPage.list.some((row) => row.id === d.id));
    assert.ok(
      operatedPage.list.every((row) => row.workflowStatus === 'operated'),
    );
    await call('lx1', 'GET', 'direct?workflowStatus=bad', undefined, 400);

    let editable = await call(
      'lx1',
      'POST',
      'direct',
      { ...direct, loss: false },
      201,
    );
    assert.equal(editable.workflowStatus, 'pending_operation');
    editable = await call('lx1', 'PUT', `direct/${editable.id}`, {
      ...direct,
      version: editable.version,
    });
    assert.equal(editable.workflowStatus, 'pending_confirmation');
    editable = await call('lx1', 'PUT', `direct/${editable.id}`, {
      ...direct,
      loss: false,
      version: editable.version,
    });
    assert.equal(editable.workflowStatus, 'pending_operation');
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
      await call(role, 'POST', 'direct', direct, role === 'ROOT' ? 400 : 403);
      await call(role, 'POST', 'shengxu', sx, role === 'ROOT' ? 400 : 403);
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
        { version: d.version },
        403,
      );
    }
    // ROOT delegates creation only; ownership follows agency/designer, not the submitter.
    const rootAgencies = await call<{
      list: { id: string; coordinatorId: string; coordinatorName: string }[];
      total: number;
    }>('ROOT', 'GET', 'shengxu/agencies');
    assert.ok(
      rootAgencies.list.some(
        (a) =>
          a.id === a2.agencyId &&
          a.coordinatorId === sx2 &&
          a.coordinatorName === 'sx2',
      ),
    );
    assert.ok(rootAgencies.list.every((a) => a.id !== foreign.agencyId));
    await call('ROOT', 'GET', `shengxu/agencies/${a2.agencyId}/contacts`);
    await call(
      'ROOT',
      'GET',
      `shengxu/agencies/${foreign.agencyId}/contacts`,
      undefined,
      400,
    );
    for (const role of ['ADMIN', 'EXECUTIVE']) {
      await call(role, 'GET', 'shengxu/agencies', undefined, 403);
      await call(
        role,
        'GET',
        `shengxu/agencies/${a2.agencyId}/contacts`,
        undefined,
        403,
      );
    }
    const delegatedShengxuInput = { ...sx, ...a2, recordDate: '2026-10-28' };
    const delegatedShengxu = await call(
      'ROOT',
      'POST',
      'shengxu',
      delegatedShengxuInput,
      201,
    );
    assert.equal(delegatedShengxu.creatorId, sx2);
    assert.equal(delegatedShengxu.creatorName, 'sx2');
    assert.equal(delegatedShengxu.updatedBy, actors.ROOT.id);
    assert.equal(delegatedShengxu.businessUnit, 'shengxu');
    assert.equal(delegatedShengxu.capabilities.canEdit, false);
    assert.equal(
      (await call('sx2', 'GET', `shengxu/${delegatedShengxu.id}`)).capabilities
        .canEdit,
      true,
    );
    await call(
      'ROOT',
      'POST',
      'shengxu',
      { ...delegatedShengxuInput, ...foreign },
      400,
    );
    await call(
      'ROOT',
      'POST',
      'shengxu',
      { ...delegatedShengxuInput, contactId: a1.contactId },
      400,
    );
    await call(
      'ROOT',
      'PUT',
      `shengxu/${delegatedShengxu.id}`,
      { ...delegatedShengxuInput, version: 1 },
      403,
    );
    await call(
      'ROOT',
      'DELETE',
      `shengxu/${delegatedShengxu.id}?version=1`,
      undefined,
      403,
    );

    const delegatedLinxi = await call(
      'ROOT',
      'POST',
      'direct',
      {
        ...direct,
        businessUnit: 'linxi',
        creatorId: lx2,
      },
      201,
    );
    assert.equal(delegatedLinxi.businessUnit, 'linxi');
    assert.equal(delegatedLinxi.creatorId, lx2);
    assert.equal(delegatedLinxi.creatorName, 'lx2');
    assert.equal(delegatedLinxi.updatedBy, actors.ROOT.id);
    assert.equal(
      (await call('lx2', 'GET', `direct/${delegatedLinxi.id}`)).capabilities
        .canChangeStatus,
      true,
    );
    const delegatedWebsiteInput = {
      ...direct,
      businessUnit: 'website',
      creatorId: web,
      operatorId: web,
      receivingAccountId: null,
    };
    const delegatedWebsite = await call(
      'ROOT',
      'POST',
      'direct',
      delegatedWebsiteInput,
      201,
    );
    assert.equal(delegatedWebsite.businessUnit, 'website');
    assert.equal(delegatedWebsite.creatorId, web);
    assert.equal(delegatedWebsite.updatedBy, actors.ROOT.id);
    assert.equal(delegatedWebsite.receivingAccountName, '独立站');
    await call('lx1', 'GET', `direct/${delegatedWebsite.id}`, undefined, 404);
    await call('web', 'GET', `direct/${delegatedLinxi.id}`, undefined, 404);
    await call(
      'ROOT',
      'POST',
      'direct',
      { ...direct, businessUnit: 'linxi' },
      400,
    );
    await call('ROOT', 'POST', 'direct', { ...direct, creatorId: lx2 }, 400);
    await call(
      'ROOT',
      'POST',
      'direct',
      { ...direct, businessUnit: 'linxi', creatorId: web },
      400,
    );
    await call(
      'ROOT',
      'POST',
      'direct',
      { ...delegatedWebsiteInput, creatorId: lx2 },
      400,
    );
    await call(
      'ROOT',
      'POST',
      'direct',
      { ...direct, businessUnit: 'linxi', creatorId: actors.lxManager.id },
      400,
    );
    await call('lx1', 'POST', 'direct', { ...direct, creatorId: lx2 }, 403);
    await call(
      'lx1',
      'POST',
      'direct',
      { ...direct, businessUnit: 'website' },
      403,
    );
    await call(
      'lx2',
      'PUT',
      `direct/${delegatedLinxi.id}`,
      { ...direct, version: 1, creatorId: lx1 },
      400,
    );
    await call(
      'lx2',
      'PUT',
      `direct/${delegatedLinxi.id}`,
      { ...direct, version: 1, businessUnit: 'website' },
      400,
    );
    await db.query("UPDATE users SET status='disabled' WHERE id=$1", [lx2]);
    await call(
      'ROOT',
      'POST',
      'direct',
      { ...direct, businessUnit: 'linxi', creatorId: lx2 },
      400,
    );
    await db.query("UPDATE users SET status='disabled' WHERE id=$1", [sx2]);
    await call(
      'ROOT',
      'POST',
      'shengxu',
      { ...delegatedShengxuInput, recordDate: '2026-10-29' },
      400,
    );
    const enabledAgencies = await call<{ list: { id: string }[] }>(
      'ROOT',
      'GET',
      'shengxu/agencies',
    );
    assert.ok(enabledAgencies.list.every((a) => a.id !== a2.agencyId));
    // Filter options use visible historical records, not enabled resource/person selectors.
    type OptionsPage = {
      list: { id: string; name: string }[];
      total: number;
      page: number;
      pageSize: number;
    };
    for (const role of ['ROOT', 'ADMIN', 'EXECUTIVE', 'sx1']) {
      const options = await call<OptionsPage>(
        role,
        'GET',
        'shengxu/filter-options?kind=agency&pageSize=1',
      );
      assert.equal(options.total, 2);
      assert.equal(options.list.length, 1);
      assert.equal(options.list[0].name, 'agency1'); // master name now changed/disabled
      const second = await call<OptionsPage>(
        role,
        'GET',
        'shengxu/filter-options?kind=agency&pageSize=1&page=2',
      );
      assert.equal(second.list[0].id, a2.agencyId);
      const creators = await call<OptionsPage>(
        role,
        'GET',
        'shengxu/filter-options?kind=creator&keyword=sx2',
      );
      assert.deepEqual(creators.list, [{ id: sx2, name: 'sx2' }]); // disabled user
    }
    for (const role of ['ROOT', 'ADMIN', 'EXECUTIVE', 'lx1']) {
      const options = await call<OptionsPage>(
        role,
        'GET',
        'direct/filter-options?kind=operator&businessUnit=linxi',
      );
      assert.ok(options.list.some((o) => o.id === lx2)); // disabled user still selectable for filtering
      assert.ok(options.list.every((o) => o.id !== web));
      const creators = await call<OptionsPage>(
        role,
        'GET',
        'direct/filter-options?kind=creator&businessUnit=linxi&keyword=lx2',
      );
      assert.deepEqual(creators.list, [{ id: lx2, name: 'lx2' }]);
    }
    for (const role of ['ROOT', 'ADMIN', 'EXECUTIVE'])
      await call(
        role,
        'GET',
        'direct/filter-options?kind=creator',
        undefined,
        400,
      );
    await call(
      'lx1',
      'GET',
      'direct/filter-options?kind=operator&businessUnit=website',
      undefined,
      403,
    );
    await call(
      'web',
      'GET',
      'direct/filter-options?kind=creator&businessUnit=linxi',
      undefined,
      403,
    );
    await call(
      'lx1',
      'GET',
      'shengxu/filter-options?kind=creator',
      undefined,
      403,
    );
    await call(
      'resource',
      'GET',
      'direct/filter-options?kind=creator',
      undefined,
      403,
    );
    await call(
      'sx1',
      'GET',
      'shengxu/filter-options?kind=operator',
      undefined,
      400,
    );
    await call(
      'sx1',
      'GET',
      'shengxu/filter-options?kind=agency&pageSize=101',
      undefined,
      400,
    );
    await call('sx1', 'GET', 'shengxu?agencyId=invalid', undefined, 400);
    await call('lx1', 'GET', 'direct?operatorId=invalid', undefined, 400);
    const sxFiltered = await call<Page>(
      'ADMIN',
      'GET',
      `shengxu?from=2026-10-28&to=2026-10-28&creatorId=${sx2}&agencyId=${a2.agencyId}&keyword=agency2`,
    );
    assert.deepEqual(
      sxFiltered.list.map((r) => r.id),
      [delegatedShengxu.id],
    );
    assert.equal(sxFiltered.total, 1);
    for (const query of [
      `from=2026-10-29&agencyId=${a2.agencyId}`,
      `to=2026-10-27&agencyId=${a2.agencyId}`,
      `creatorId=${sx1}&agencyId=${a2.agencyId}`,
      `agencyId=${foreign.agencyId}`,
    ])
      assert.equal(
        (await call<Page>('sx1', 'GET', `shengxu?${query}`)).total,
        0,
      );
    const directQuery = `businessUnit=linxi&from=2026-10-19&to=2026-10-19&creatorId=${lx1}&operatorId=${lx2}&workflowStatus=pending_operation`;
    const fullDirect = await call<Page>(
      'ADMIN',
      'GET',
      `direct?${directQuery}`,
    );
    assert.ok(fullDirect.total > 0);
    const pagedDirect = await call<Page>(
      'ADMIN',
      'GET',
      `direct?${directQuery}&pageSize=1`,
    );
    assert.equal(pagedDirect.total, fullDirect.total);
    assert.equal(pagedDirect.list.length, 1);
    for (const query of [
      `from=2026-10-20&creatorId=${lx1}`,
      `to=2026-10-18&creatorId=${lx1}`,
      `operatorId=${web}`,
      `creatorId=${web}`,
    ])
      assert.equal(
        (await call<Page>('lx1', 'GET', `direct?${query}`)).total,
        0,
      );
    await call(
      'sx1',
      'GET',
      'shengxu?from=2026-10-21&to=2026-10-20',
      undefined,
      400,
    );
    await call(
      'lx1',
      'GET',
      'direct?from=2026-10-21&to=2026-10-20',
      undefined,
      400,
    );

    // Minimal manual-tour fixtures in this disposable database, including a hidden same-business tour.
    const [country] = await db.query<{ id: string }[]>(
      `SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' LIMIT 1`,
    );
    async function tourFixture(
      unit: string,
      owner: string,
      operator: string,
      agency: string,
      date: string,
      status = 'active',
    ) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO tours (id,tour_no,source_module,business_unit,agency_name,days,start_date,pickup_at,drop_at,occupy_from,occupy_to,country_item_id,country_code,country_name,creator_id,creator_tour_code,creator_sequence,collect_coordinator_id,collect_coordinator_name,operator_id,operator_name,adults,children,leaders,schedule_mode,itinerary_summary,status)
        VALUES ($1::uuid,$1::uuid::text,'manual',$2,$3,1,$4::date,$4::date,$4::date,$4::date,$4::date,$5,'CHN','中国',$6,'TEST',1,$6,$7,$8,$9,1,0,0,'manual','filter fixture',$10)`,
        [
          id,
          unit,
          agency,
          date,
          country.id,
          actors[owner].id,
          owner,
          actors[operator].id,
          operator,
          status,
        ],
      );
      return id;
    }
    const tourA = await tourFixture(
      'linxi',
      'lx1',
      'lx2',
      '平台 A',
      '2026-10-20',
    );
    await tourFixture(
      'linxi',
      'lx1',
      'lx2',
      '平台 A',
      '2026-10-21',
      'cancelled',
    );
    const tourB = await tourFixture(
      'linxi',
      'lx3',
      'lx3',
      '隐藏平台',
      '2026-10-20',
    );
    await tourFixture('website', 'web', 'web', '独立站平台', '2026-10-20');
    const toursQuery = `businessUnit=linxi&from=2026-10-20&to=2026-10-20&collectCoordinatorId=${lx1}&operatorId=${lx2}&agencyName=${encodeURIComponent('平台 A')}&status=active`;
    const toursFiltered = await call<Page>(
      'ADMIN',
      'GET',
      `/tours?${toursQuery}`,
    );
    assert.deepEqual(
      toursFiltered.list.map((r) => r.id),
      [tourA],
    );
    assert.equal(toursFiltered.total, 1);
    const allTours = await call<Page>(
      'ADMIN',
      'GET',
      '/tours?businessUnit=linxi&pageSize=1',
    );
    assert.equal(allTours.total, 3);
    assert.equal(allTours.list.length, 1);
    const ownTours = await call<Page>('lx1', 'GET', '/tours');
    assert.equal(ownTours.total, 2);
    assert.ok(ownTours.list.every((r) => r.id !== tourB));
    for (const query of [
      `from=2026-10-22`,
      `to=2026-10-19`,
      `collectCoordinatorId=${web}`,
      `operatorId=${web}`,
      `agencyName=${encodeURIComponent('平台')}`,
      `businessUnit=website`,
    ])
      assert.equal(
        (await call<Page>('lx1', 'GET', `/tours?${query}`)).total,
        0,
      );
    for (const role of ['ROOT', 'ADMIN', 'EXECUTIVE']) {
      const options = await call<OptionsPage>(
        role,
        'GET',
        '/tours/filter-options?kind=agency&businessUnit=linxi&pageSize=1',
      );
      assert.equal(options.total, 2); // duplicate agency snapshots deduplicated
      assert.equal(options.list.length, 1);
      const operators = await call<OptionsPage>(
        role,
        'GET',
        '/tours/filter-options?kind=operator&businessUnit=linxi&keyword=lx2',
      );
      assert.deepEqual(operators.list, [{ id: lx2, name: 'lx2' }]);
    }
    const ownAgencies = await call<OptionsPage>(
      'lx1',
      'GET',
      '/tours/filter-options?kind=agency',
    );
    assert.deepEqual(ownAgencies.list, [{ id: '平台 A', name: '平台 A' }]);
    const ownCollectors = await call<OptionsPage>(
      'lx1',
      'GET',
      '/tours/filter-options?kind=collectCoordinator',
    );
    assert.deepEqual(ownCollectors.list, [{ id: lx1, name: 'lx1' }]);
    assert.equal(
      (
        await call<OptionsPage>(
          'lx1',
          'GET',
          '/tours/filter-options?kind=agency&businessUnit=website',
        )
      ).total,
      0,
    );
    await call(
      'resource',
      'GET',
      '/tours/filter-options?kind=agency',
      undefined,
      403,
    );
    for (const query of [
      'collectCoordinatorId=invalid',
      'operatorId=invalid',
      'from=2026-02-30',
      'from=2026-10-21&to=2026-10-20',
    ])
      await call('ADMIN', 'GET', `/tours?${query}`, undefined, 400);
    await call(
      'ADMIN',
      'GET',
      '/tours/filter-options?kind=invalid',
      undefined,
      400,
    );
    await call(
      'ADMIN',
      'GET',
      '/tours/filter-options?kind=agency&page=0',
      undefined,
      400,
    );
    // Editor choices and server-side enforcement, using the same isolated HTTP application.
    await db.query(
      "UPDATE users SET tour_code='EDITOR' WHERE id=ANY($1::uuid[])",
      [[sx1, lx1, web, actors.ROOT.id]],
    );
    const newAgency = await agency('可选盛旭组团社', sx1);
    const english = randomUUID(),
      french = randomUUID(),
      inactive = randomUUID();
    await db.query(
      `INSERT INTO resource_guide_people(id,code,name,language,status) VALUES
      ($1,'FILTER-EN','英语导游',' English ','enabled'),($2,'FILTER-FR','法语导游','French','enabled'),($3,'FILTER-OFF','停用导游','DisabledOnly','disabled')`,
      [english, french, inactive],
    );
    const languages = await call<OptionsPage>(
      'sx1',
      'GET',
      '/tours/guide-languages?pageSize=1',
    );
    assert.equal(languages.total, 2);
    assert.deepEqual(languages.list, [{ id: 'English', name: 'English' }]);
    const searchedLanguages = await call<OptionsPage>(
      'sx1',
      'GET',
      '/tours/guide-languages?keyword=French',
    );
    assert.deepEqual(searchedLanguages.list, [
      { id: 'French', name: 'French' },
    ]);
    const secondLanguages = await call<OptionsPage>(
      'sx1',
      'GET',
      '/tours/guide-languages?page=2&pageSize=1',
    );
    assert.deepEqual(secondLanguages.list, [{ id: 'French', name: 'French' }]);
    await call('resource', 'GET', '/tours/guide-languages', undefined, 403);
    const guideQuery = {
      businessUnit: 'shengxu',
      serviceStartAt: '2026-12-01 09:00',
      serviceEndAt: '2026-12-01 18:00',
    };
    const candidates = await call<{ id: string }[]>(
      'sx1',
      'POST',
      '/tours/available-guides',
      { ...guideQuery, language: 'English' },
    );
    assert.deepEqual(
      candidates.map((r) => r.id),
      [english],
    );
    assert.deepEqual(
      await call('sx1', 'POST', '/tours/available-guides', {
        ...guideQuery,
        language: 'Eng',
      }),
      [],
    );
    await call('sx1', 'POST', '/tours/available-guides', guideQuery, 400);
    await call(
      'web',
      'POST',
      '/tours/available-guides',
      { ...guideQuery, language: 'English' },
      403,
    );
    const manualInput = {
      sourceModule: 'manual',
      scheduleMode: 'manual',
      operatorId: sx1,
      adults: 0,
      children: 0,
      leaders: 0,
      language: 'English',
      shopping: false,
      pickupAt: '2026-12-01 09:00',
      dropAt: '2026-12-01 18:00',
      guideServices: [
        {
          guideId: english,
          language: 'English',
          serviceStartAt: guideQuery.serviceStartAt,
          serviceEndAt: guideQuery.serviceEndAt,
          remark: '',
        },
      ],
      manualSource: {
        businessUnit: 'shengxu',
        countryItemId: country.id,
        collectCoordinatorId: sx1,
        agencyId: newAgency.agencyId,
        contactName: '',
        itinerarySummary: '编辑验证',
        startDate: '2026-12-01',
        days: 1,
      },
    };
    type EditorTour = {
      id: string;
      version: number;
      agencyId: string | null;
      agencyName: string;
      language: string;
      guideServices: Array<{
        id: string;
        guideId: string;
        language: string;
        serviceStartAt: string;
        serviceEndAt: string;
        remark: string;
      }>;
    };
    for (const agencyId of [
      undefined,
      a1.agencyId,
      foreign.agencyId,
      randomUUID(),
    ])
      await call(
        'sx1',
        'POST',
        '/tours',
        {
          ...manualInput,
          manualSource: { ...manualInput.manualSource, agencyId },
        },
        400,
      );
    await call(
      'sx1',
      'POST',
      '/tours',
      {
        ...manualInput,
        manualSource: { ...manualInput.manualSource, agencyName: '伪造名称' },
      },
      400,
    );
    const noResource = {
      ...actors.sx1,
      permissions: actors.sx1.permissions.filter(
        (p) => p !== 'resource:agency:list',
      ),
    };
    actors.noAgencyRead = noResource;
    await call('noAgencyRead', 'POST', '/tours', manualInput, 403);
    await call(
      'sx1',
      'POST',
      '/tours',
      {
        ...manualInput,
        guideServices: [{ ...manualInput.guideServices[0], guideId: french }],
      },
      400,
    );
    await call(
      'sx1',
      'POST',
      '/tours',
      { ...manualInput, language: 'Invented', guideServices: [] },
      400,
    );
    let editorTour = await call<EditorTour>(
      'sx1',
      'POST',
      '/tours',
      manualInput,
      201,
    );
    assert.equal(editorTour.agencyId, newAgency.agencyId);
    assert.equal(editorTour.agencyName, '可选盛旭组团社');
    assert.deepEqual(
      await call('sx1', 'POST', '/tours/available-guides', {
        ...guideQuery,
        language: 'English',
      }),
      [],
    ); // occupied
    assert.equal(
      (
        await call<{ id: string }[]>('sx1', 'POST', '/tours/available-guides', {
          ...guideQuery,
          language: 'English',
          excludeTourId: editorTour.id,
        })
      )[0].id,
      english,
    );
    const updateEditor = {
      ...manualInput,
      sourceModule: undefined,
      guideServices: editorTour.guideServices,
    };
    await call(
      'sx1',
      'PUT',
      `/tours/${editorTour.id}`,
      {
        ...updateEditor,
        guideServices: [
          { ...updateEditor.guideServices[0], language: 'French' },
        ],
        version: editorTour.version,
      },
      400,
    );
    // Retain IDs/snapshots after resources are disabled, then require matching language on any new allocation.
    await db.query(
      "UPDATE resource_agencies SET name='新名称',status='disabled' WHERE id=$1",
      [newAgency.agencyId],
    );
    await db.query(
      "UPDATE resource_guide_people SET status='disabled' WHERE id=$1",
      [english],
    );
    editorTour = await call<EditorTour>(
      'sx1',
      'PUT',
      `/tours/${editorTour.id}`,
      { ...updateEditor, version: editorTour.version },
    );
    assert.equal(editorTour.agencyName, '可选盛旭组团社');
    await call(
      'sx1',
      'PUT',
      `/tours/${editorTour.id}`,
      {
        ...updateEditor,
        guideServices: [
          {
            ...updateEditor.guideServices[0],
            serviceStartAt: '2026-12-01 10:00',
          },
        ],
        version: editorTour.version,
      },
      400,
    );
    editorTour = await call<EditorTour>(
      'sx1',
      'PUT',
      `/tours/${editorTour.id}`,
      {
        ...updateEditor,
        language: 'French',
        guideServices: [
          {
            guideId: french,
            language: 'French',
            serviceStartAt: guideQuery.serviceStartAt,
            serviceEndAt: guideQuery.serviceEndAt,
            remark: '',
          },
        ],
        version: editorTour.version,
      },
    );
    assert.equal(editorTour.guideServices[0].guideId, french);
    assert.equal(editorTour.language, 'French');
    for (const [actorName, businessUnit, platform] of [
      ['lx1', 'linxi', '霖熹'],
      ['web', 'website', '独立站'],
    ] as const) {
      const directInput = {
        ...manualInput,
        guideServices: [],
        language: '',
        operatorId: actors[actorName].id,
        manualSource: {
          ...manualInput.manualSource,
          businessUnit,
          collectCoordinatorId: actors[actorName].id,
          agencyId: undefined,
        },
      };
      const directTour = await call<EditorTour>(
        actorName,
        'POST',
        '/tours',
        directInput,
        201,
      );
      assert.equal(directTour.agencyName, platform);
      assert.equal(directTour.agencyId, null);
      await call(
        actorName,
        'POST',
        '/tours',
        {
          ...directInput,
          manualSource: { ...directInput.manualSource, agencyId: a3.agencyId },
        },
        400,
      );
      const rootTour = await call<EditorTour>(
        'ROOT',
        'POST',
        '/tours',
        directInput,
        201,
      );
      assert.equal(rootTour.agencyName, platform);
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
