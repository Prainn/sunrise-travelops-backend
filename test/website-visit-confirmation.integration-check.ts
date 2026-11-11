/** Disposable localhost PostgreSQL 16 only; never reads application env files. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthenticatedUser } from '../src/auth/auth.types';
import { effectiveAccountPermissions } from '../src/auth/identity-permissions';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { createValidationException } from '../src/common/validation/validation-exception.factory';
import { WebsiteService } from '../src/website/website.service';
import { WebsiteVisitsController } from '../src/lynx/website-visits.controller';
import { WebsiteVisitsService } from '../src/lynx/website-visits.service';
import { WebsiteVisitsReader } from '../src/lynx/website-visits-reader';

const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55451,
  username: 'postgres',
  password: 'isolated-website-fields-test',
};
const admin = new DataSource({ ...connection, database: 'postgres' });
const names = [
  `visit_confirm_source_${Date.now()}`,
  `visit_confirm_business_${Date.now()}`,
];
const sources: DataSource[] = [];
const created: string[] = [];
const readerRole = `visit_confirm_reader_${process.pid}`;
const actors: Record<string, AuthenticatedUser> = {};
let app: INestApplication | undefined;
let base = '';
let checks = 0;
let createCalls = 0;
function actor(
  username: string,
  scope: AuthenticatedUser['scope'],
  role: string,
) {
  actors[username] = {
    id: randomUUID(),
    identityId: randomUUID(),
    username,
    nickname: username,
    scope,
    scopeName: scope,
    deptId: null,
    deptName: '',
    roles: [role],
    menuKeys: [],
    permissions: effectiveAccountPermissions(scope, [role], null, username),
  };
}
async function call(
  actorName: string,
  path: string,
  method = 'GET',
  status = 200,
) {
  const response = await fetch(`${base}/api/ledgers/website-visits${path}`, {
    method,
    headers: { 'x-test-actor': actorName },
    signal: AbortSignal.timeout(10000),
  });
  const payload = (await response.json()) as {
    code: string;
    data: {
      confirmed?: boolean;
      list: { id: string; confirmed: boolean; converted: boolean }[];
    };
  };
  assert.equal(
    response.status,
    status,
    `${actorName} ${method} ${path}: ${JSON.stringify(payload)}`,
  );
  assert.equal(
    payload.code,
    (
      {
        200: 'SUCCESS',
        400: 'BAD_REQUEST',
        403: 'AUTH_FORBIDDEN',
        404: 'NOT_FOUND',
      } as Record<number, string>
    )[status],
  );
  checks++;
  return payload.data;
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
    for (const name of names) {
      await admin.query(`CREATE DATABASE "${name}"`);
      created.push(name);
      sources.push(
        await new DataSource({
          ...connection,
          database: name,
          synchronize: false,
          migrations: [resolve(__dirname, '../src/migrations/*.ts')],
          entities: [resolve(__dirname, '../src/**/*.entity.ts')],
        }).initialize(),
      );
    }
    const [source, db] = sources;
    assert.equal(
      (await source.runMigrations()).length,
      source.migrations.length,
    );
    assert.equal((await source.runMigrations()).length, 0);
    const migrations = [...db.migrations];
    db.migrations.splice(
      0,
      db.migrations.length,
      ...migrations.filter(
        (m) =>
          (m.name ?? m.constructor.name) !==
          'AddWebsiteVisitConfirmations1795392000000',
      ),
    );
    await db.runMigrations();
    actor('coordinator', 'website', 'COORDINATOR');
    actor('manager', 'website', 'BUSINESS_MANAGER');
    actor('admin', 'headquarters', 'ADMIN');
    actor('executive', 'headquarters', 'EXECUTIVE');
    actor('mango', 'headquarters', 'ROOT');
    actor('sunrise', 'headquarters', 'BOSS');
    actor('linxi', 'linxi', 'COORDINATOR');
    actor('shengxu', 'shengxu', 'BUSINESS_MANAGER');
    actor('resource', 'website', 'RESOURCE_MANAGER');
    const owner = actors.coordinator.id;
    const inquiry = randomUUID(),
      visit = randomUUID(),
      unconvertedVisit = randomUUID();
    await db.query(
      `INSERT INTO users(id,username,password_hash,nickname,english_name) VALUES($1,'visit-fixture','test-only','Fixture','Fixture')`,
      [owner],
    );
    await db.query(
      `INSERT INTO website_inquiries(id,code,customer_name,planned_days,requirements,owner_id,owner,status,business_unit) VALUES($1,'WIQ-EXISTING','Fixture',1,'Existing',$2,'Fixture','new','website')`,
      [inquiry, owner],
    );
    await db.query(
      'INSERT INTO website_visit_inquiries(visit_id,inquiry_id) VALUES($1,$2)',
      [visit, inquiry],
    );
    const existing = await db.query<unknown[]>(
      'SELECT * FROM website_inquiries ORDER BY id',
    );
    db.migrations.splice(0, db.migrations.length, ...migrations);
    assert.equal((await db.runMigrations()).length, 1);
    assert.equal((await db.runMigrations()).length, 0);
    assert.deepEqual(
      await db.query('SELECT * FROM website_inquiries ORDER BY id'),
      existing,
    );
    for (const [id, ref] of [
      [visit, 'CONFIRM-CONVERTED'],
      [unconvertedVisit, 'CONFIRM-NEW'],
    ]) {
      await source.query(
        `INSERT INTO lynx_visits(id,whatsapp_reference,website_inquiry_id,contract_version,created_at_utc,expires_at_utc,payload_fingerprint) VALUES($1,$2,$2,'test','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z'::timestamptz+interval '180 days',repeat('a',64))`,
        [id, ref],
      );
    }
    const originalSource = await source.query<unknown[]>(
      'SELECT * FROM lynx_visits ORDER BY id',
    );
    await admin.query(
      `CREATE ROLE "${readerRole}" LOGIN PASSWORD 'confirmation-reader-only'`,
    );
    await source.query(
      `GRANT USAGE ON SCHEMA public TO "${readerRole}"; GRANT SELECT ON lynx_visits TO "${readerRole}"`,
    );
    const module = await Test.createTestingModule({
      controllers: [WebsiteVisitsController],
      providers: [
        WebsiteVisitsService,
        WebsiteVisitsReader,
        { provide: DataSource, useValue: db },
        {
          provide: WebsiteService,
          useValue: {
            create: () => {
              createCalls++;
              throw new Error('Confirmation must not create an inquiry');
            },
          },
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            LYNX_VISITS_DB_HOST: '127.0.0.1',
            LYNX_VISITS_DB_PORT: 55451,
            LYNX_VISITS_DB_NAME: names[0],
            LYNX_VISITS_DB_USER: readerRole,
            LYNX_VISITS_DB_PASSWORD: 'confirmation-reader-only',
          }),
        },
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
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        exceptionFactory: createValidationException,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    assert((await call('coordinator', '')).list.every((row) => !row.confirmed));
    for (const denied of ['sunrise', 'linxi', 'shengxu', 'resource'])
      await call(denied, `/${visit}/confirm`, 'POST', 403);
    await call('coordinator', '/invalid/confirm', 'POST', 400);
    await call('coordinator', `/${randomUUID()}/confirm`, 'POST', 404);
    assert.equal(
      (await db.query<unknown[]>('SELECT * FROM website_visit_confirmations'))
        .length,
      0,
    );
    const confirmed = await Promise.all(
      ['coordinator', 'manager', 'admin', 'executive', 'mango'].map((name) =>
        call(name, `/${visit}/confirm`, 'POST'),
      ),
    );
    assert(confirmed.every((result) => result.confirmed));
    assert.equal(
      (await db.query<unknown[]>('SELECT * FROM website_visit_confirmations'))
        .length,
      1,
    );
    await call('admin', `/${visit}/confirm`, 'POST');
    await call('executive', `/${unconvertedVisit}/confirm`, 'POST');
    const refreshed = (await call('coordinator', '')).list;
    assert.equal(refreshed.find((row) => row.id === visit)?.confirmed, true);
    assert.equal(refreshed.find((row) => row.id === visit)?.converted, true);
    assert.equal(
      refreshed.find((row) => row.id === unconvertedVisit)?.confirmed,
      true,
    );
    assert.equal(
      refreshed.find((row) => row.id === unconvertedVisit)?.converted,
      false,
    );
    assert.equal(createCalls, 0);
    assert.deepEqual(
      await db.query('SELECT * FROM website_inquiries ORDER BY id'),
      existing,
    );
    assert.deepEqual(
      await source.query('SELECT * FROM lynx_visits ORDER BY id'),
      originalSource,
    );
    assert.equal(
      (
        await source.query<unknown[]>(
          'SELECT * FROM website_visit_confirmations',
        )
      ).length,
      0,
    );
    console.log(
      `PASS: ${checks} HTTP checks; empty/repeat and existing-data migrations, role permissions, duplicate/concurrent confirmation, reload persistence, converted/unconverted visits, independent environments, unchanged inquiry and read-only source.`,
    );
  } finally {
    await app?.close();
    for (const db of sources) if (db.isInitialized) await db.destroy();
    for (const name of created)
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS "${readerRole}"`);
    await admin.destroy();
  }
}
run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
