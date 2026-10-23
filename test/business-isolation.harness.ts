/** Real modules/guards/SQL, with credentials independent of DATABASE_* and .env. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { AuthModule } from '../src/auth/auth.module';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { createValidationException } from '../src/common/validation/validation-exception.factory';
import { InquiriesModule } from '../src/inquiries/inquiries.module';
import { LedgersModule } from '../src/ledgers/ledgers.module';
import { ToursModule } from '../src/tours/tours.module';
import { WebsiteModule } from '../src/website/website.module';
import { LoginScope } from '../src/users/user-identity.entity';

export interface Actor {
  id: string;
  identityId: string;
  scope: LoginScope;
  token: string;
}
export interface RecordRef {
  id: string;
  version: number;
  businessUnit: string;
}
export interface Page<T = RecordRef> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export class IsolationHarness {
  private readonly database = `travelops_isolation_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  private admin: DataSource;
  db: DataSource;
  private created = false;
  private app?: INestApplication;
  private base = '';
  private passwordHash = '';
  private actors = 0;
  requests = 0;

  constructor() {
    const port = Number(process.env.ISOLATION_PG_PORT ?? '55457');
    assert(Number.isInteger(port) && port > 0 && port <= 65535);
    const connection = {
      type: 'postgres' as const,
      host: '127.0.0.1',
      port,
      username: 'postgres',
      password: process.env.ISOLATION_PG_PASSWORD ?? 'isolation-ci-only',
      ssl: false as const,
      connectTimeoutMS: 5000,
    };
    // Only a fresh name generated here can be created/migrated/dropped.
    this.admin = new DataSource({ ...connection, database: 'postgres' });
    this.db = new DataSource({
      ...connection,
      database: this.database,
      entities: [resolve(__dirname, '../src/**/*.entity.ts')],
      migrations: [resolve(__dirname, '../src/migrations/*.ts')],
      synchronize: false,
    });
  }

  async start() {
    await this.admin.initialize();
    assert.match(this.database, /^travelops_isolation_\d+_[a-f0-9]{32}$/);
    await this.admin.query(`CREATE DATABASE "${this.database}"`);
    this.created = true;
    await this.db.initialize();
    assert(
      this.db.migrations.length > 0,
      'Migration discovery must not be empty',
    );
    assert.equal(
      (await this.db.runMigrations()).length,
      this.db.migrations.length,
    );
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [
            () => ({
              JWT_SECRET: 'isolation-access-secret-never-used-outside-tests',
              JWT_EXPIRES_IN: '1h',
              REFRESH_TOKEN_SECRET:
                'isolation-refresh-secret-never-used-outside-tests',
              REFRESH_TOKEN_EXPIRES_IN: '1d',
            }),
          ],
        }),
        TypeOrmModule.forRoot({ ...this.db.options, migrations: [] }),
        AuthModule,
        InquiriesModule,
        WebsiteModule,
        ToursModule,
        LedgersModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();
    this.app = module.createNestApplication({ logger: false });
    this.app.setGlobalPrefix('api');
    this.app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: createValidationException,
      }),
    );
    this.app.useGlobalFilters(new ApiExceptionFilter());
    await this.app.listen(0, '127.0.0.1');
    this.base = `${await this.app.getUrl()}/api`;
    this.passwordHash = await argon2.hash('isolation-fixture-password');
  }

  async close() {
    try {
      await this.app?.close();
    } finally {
      try {
        if (this.db.isInitialized) await this.db.destroy();
      } finally {
        if (this.admin.isInitialized) {
          try {
            if (this.created)
              await this.admin.query(
                `DROP DATABASE "${this.database}" WITH (FORCE)`,
              );
          } finally {
            await this.admin.destroy();
          }
        }
      }
    }
  }

  async actor(
    scope: LoginScope,
    role = 'COORDINATOR',
    duty: string | null = 'both',
    userId?: string,
  ): Promise<Actor> {
    let username = `iso_${scope}_${++this.actors}`;
    const id = userId ?? randomUUID();
    const identityId = randomUUID();
    if (userId) {
      const [user] = await this.db.query<{ username: string }[]>(
        'SELECT username FROM users WHERE id=$1',
        [userId],
      );
      assert(user, 'Existing account required for a second identity');
      username = user.username;
    } else
      await this.db.query(
        `INSERT INTO users(id,username,password_hash,nickname,english_name,tour_code) VALUES($1,$2,$3,$2,$2,$4)`,
        [id, username, this.passwordHash, `ISO${this.actors}`],
      );
    await this.db.query(
      `INSERT INTO user_identities(id,user_id,username,scope,coordinator_duty) VALUES($1,$2,$3,$4,$5)`,
      [identityId, id, username, scope, role === 'COORDINATOR' ? duty : null],
    );
    await this.db.query(
      `INSERT INTO roles(code,name) VALUES($1,$1) ON CONFLICT(code) DO NOTHING`,
      [role],
    );
    await this.db.query(
      `INSERT INTO identity_roles(identity_id,role_id) SELECT $1,id FROM roles WHERE code=$2`,
      [identityId, role],
    );
    // Login creates a real session; JWT validation re-reads the current identity.
    const login = await this.call<{ accessToken: string }>(
      undefined,
      'POST',
      '/auth/login',
      { username, password: 'isolation-fixture-password', scope },
    );
    assert(login.accessToken);
    return { id, identityId, scope, token: login.accessToken };
  }

  async call<T = RecordRef>(
    actor: Actor | undefined,
    method: string,
    path: string,
    body?: unknown,
    status = 200,
    code = 'SUCCESS',
  ): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(actor ? { authorization: `Bearer ${actor.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await response.text();
    const label = `${actor?.scope ?? 'anonymous'} ${method} ${path}`;
    assert.equal(response.status, status, `${label}: ${raw}`);
    this.requests++;
    if (status === 204) return undefined as T;
    const result = JSON.parse(raw) as { code: string; data: T };
    assert.equal(result.code, code, `${label}: ${raw}`);
    return result.data;
  }

  async page(
    actor: Actor,
    path: string,
    expectedIds: string[],
    pageSize = 100,
  ) {
    const separator = path.includes('?') ? '&' : '?';
    const result = await this.call<Page>(
      actor,
      'GET',
      `${path}${separator}pageSize=${pageSize}`,
    );
    assert.equal(result.total, expectedIds.length, path);
    assert.equal(result.page, 1);
    assert.equal(result.pageSize, pageSize);
    assert.equal(
      result.list.length,
      Math.min(pageSize, expectedIds.length),
      path,
    );
    if (expectedIds.length <= pageSize)
      assert.deepEqual(
        result.list.map((r) => r.id).sort(),
        [...expectedIds].sort(),
        path,
      );
    else {
      const ids = [...result.list.map((r) => r.id)];
      for (let page = 2; ids.length < result.total; page++) {
        const next = await this.call<Page>(
          actor,
          'GET',
          `${path}${separator}pageSize=${pageSize}&page=${page}`,
        );
        assert.equal(next.total, expectedIds.length, path);
        assert.equal(
          next.list.length,
          Math.min(pageSize, result.total - ids.length),
          path,
        );
        ids.push(...next.list.map((r) => r.id));
      }
      assert.deepEqual(ids.sort(), [...expectedIds].sort(), path);
    }
    return result;
  }

  async unchanged(check: () => Promise<void>) {
    const snapshot = async () => {
      const tables = [
        'direct_ledgers',
        'shengxu_ledgers',
        'tours',
        'inquiries',
        'inquiry_logs',
        'inquiry_transfers',
        'itineraries',
        'itinerary_quotes',
        'website_inquiries',
        'website_itineraries',
        'website_logs',
        'website_quotations',
        'website_inquiry_numbers',
        'website_config_versions',
      ];
      const result: Record<string, unknown> = {};
      for (const table of tables)
        result[table] = await this.db.query(
          `SELECT * FROM ${table} ORDER BY 1`,
        );
      return result;
    };
    const before = await snapshot();
    await check();
    assert.deepEqual(
      await snapshot(),
      before,
      'Denied operations changed business data, versions, snapshots or success logs',
    );
  }
}
