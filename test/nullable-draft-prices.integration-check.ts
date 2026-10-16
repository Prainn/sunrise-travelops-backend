/** Disposable PostgreSQL only: localhost:55446, no environment-file database configuration. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserEntity } from '../src/users/user.entity';
import { UserIdentityEntity } from '../src/users/user-identity.entity';
import { RoleEntity } from '../src/roles/role.entity';
import { AuthService } from '../src/auth/auth.service';
import { AgenciesService } from '../src/resources/agencies/agencies.service';
import { InquiriesService } from '../src/inquiries/inquiries.service';
import { ItineraryValidation } from '../src/inquiries/itinerary-validation';
import {
  InquiryEntity,
  ItineraryEntity,
  ItineraryQuoteEntity,
} from '../src/inquiries/inquiry.entity';
import { ItineraryInput } from '../src/inquiries/inquiry.dto';
import {
  loadItineraryData,
  saveItineraryData,
} from '../src/inquiries/structured-itinerary';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { createValidationException } from '../src/common/validation/validation-exception.factory';
import { priceDraft, priceResourceIds } from './fixtures/nullable-draft-prices';

const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55446,
  username: 'postgres',
  password: 'isolated-test-only',
};
const admin = new DataSource({ ...connection, database: 'postgres' });
const databases = [
  `nullable_prices_empty_${Date.now()}`,
  `nullable_prices_old_${Date.now()}`,
];
const migrationName = 'AllowNullDraftActualPrices1792195200000';
const source = (database: string) =>
  new DataSource({
    ...connection,
    database,
    synchronize: false,
    migrations: ['src/migrations/*.ts'],
    entities: ['src/**/*.entity.ts'],
  });

async function run() {
  await admin.initialize();
  let db: DataSource | undefined;
  try {
    for (const name of databases)
      await admin.query(`CREATE DATABASE "${name}"`);
    db = await source(databases[0]).initialize();
    const migrationCount = db.migrations.length;
    assert.equal((await db.runMigrations()).length, migrationCount);
    assert.equal((await db.runMigrations()).length, 0);
    await db.destroy();
    db = await source(databases[1]).initialize();
    const all = [...db.migrations];
    db.migrations.splice(
      0,
      db.migrations.length,
      ...all.filter((m) => m.name !== migrationName),
    );
    await db.runMigrations();

    const user = await db.manager.save(
      UserEntity,
      db.manager.create(UserEntity, {
        username: 'nullable_prices_root',
        passwordHash: 'isolated-test-only',
        nickname: '价格测试',
        englishName: 'Price Test',
        isSuperuser: true,
      }),
    );
    const identity = await db.manager.save(
      UserIdentityEntity,
      db.manager.create(UserIdentityEntity, {
        userId: user.id,
        username: user.username,
        scope: 'headquarters',
        deptId: null,
        roles: [await db.manager.findOneByOrFail(RoleEntity, { code: 'ROOT' })],
      }),
    );
    await db.query(
      "INSERT INTO resource_cities(code,name,province) VALUES('CITY-900','杭州','浙江')",
    );
    await db.query(
      "INSERT INTO resource_hotels(id,code,name,city,rating,individual_price,unit) VALUES($1,'HTL-900','酒店','杭州',4,100,'roomNight')",
      [priceResourceIds.hotel],
    );
    await db.query(
      "INSERT INTO resource_guides(id,code,name,daily_price,second_language,shopping) VALUES($1,'GDE-900','导游服务',100,'none',false)",
      [priceResourceIds.guide],
    );
    await db.query(
      "INSERT INTO resource_restaurants(id,code,name,city,description,price,unit,diner_count) VALUES($1,'RES-900','restaurant','杭州','餐食',100,'table',3)",
      [priceResourceIds.restaurant],
    );
    await db.query(
      "INSERT INTO resource_attractions(id,code,name,area,description,price,unit) VALUES($1,'ATT-900','attraction','杭州','景点',100,'personVisit')",
      [priceResourceIds.attraction],
    );
    const agencyId = randomUUID(),
      contactId = randomUUID();
    await db.query(
      "INSERT INTO resource_agencies(id,code,name,business_unit,coordinator_id) VALUES($1,'AGY-900','测试组团社','shengxu',$2)",
      [agencyId, user.id],
    );
    await db.query(
      "INSERT INTO resource_agency_contacts(id,agency_id,name,name_key) VALUES($1,$2,'联系人','联系人')",
      [contactId, agencyId],
    );
    const inquiry = await db.manager.save(
      InquiryEntity,
      Object.assign(new InquiryEntity(), {
        code: 'INQ-NULLABLE',
        ownerId: user.id,
        owner: user.nickname,
        creator: user.username,
        businessUnit: 'shengxu',
        status: 'planning',
        data: {
          agencyId,
          contactId,
          agencyCode: 'AGY-900',
          agencyName: '测试组团社',
          contactName: '联系人',
          email: '',
          phone: '',
          countryItemId: null,
          countryCode: null,
          countryOrRegion: '',
          sourceChannel: 'test',
          originalMessage: 'test',
          internalRemark: '',
          plannedDays: 1,
          nextFollowUpAt: null,
          lostReason: '',
        },
      }),
    );
    const validation = new ItineraryValidation();
    const oldService = new InquiriesService(
      db,
      validation,
      {} as AgenciesService,
    );
    const actor = {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      identityId: identity.id,
      scope: 'headquarters' as const,
      scopeName: '总部',
      deptId: null,
      deptName: '',
      roles: ['ROOT'],
      permissions: ['inquiry:list', 'inquiry:update', 'itinerary:pdf'],
      menuKeys: [],
      name: user.nickname,
      admin: true,
      ip: '127.0.0.1',
      requestId: 'test',
    };
    const priced = await validation.normalize(db.manager, priceDraft());
    const makeRow = async (code: string) => {
      const row = await db!.manager.save(
        ItineraryEntity,
        Object.assign(new ItineraryEntity(), {
          inquiryId: inquiry.id,
          code,
          creator: user.username,
          status: 'draft',
          data: priced,
          title: priced.title,
          startDate: priced.startDate,
          paxTiers: priced.paxTiers,
          childRate: priced.childRate,
          childWithoutBedRate: priced.childWithoutBedRate,
        }),
      );
      await saveItineraryData(db!.manager, row);
      return row;
    };
    const draft = await makeRow('ITI-NULLABLE');
    const historical = await makeRow('ITI-HISTORICAL');
    const frozenBefore = await oldService.confirmPdf(
      historical.id,
      { version: 1, inquiryVersion: inquiry.version },
      actor,
    );
    const before = await loadItineraryData(
      db.manager,
      await db.manager.findOneByOrFail(ItineraryEntity, { id: draft.id }),
    );
    db.migrations.splice(0, db.migrations.length, ...all);
    assert.deepEqual(
      (await db.runMigrations()).map((m) => m.name),
      [migrationName],
    );
    assert.equal((await db.runMigrations()).length, 0);
    const after = await loadItineraryData(
      db.manager,
      await db.manager.findOneByOrFail(ItineraryEntity, { id: draft.id }),
    );
    assert.deepEqual(after.data, before.data);
    assert.deepEqual(
      (
        await db.manager.findOneByOrFail(ItineraryQuoteEntity, {
          itineraryId: historical.id,
        })
      ).snapshot,
      structuredClone(frozenBefore),
    );

    Object.assign(process.env, {
      ENV_FILE: '/dev/null',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_HOST: connection.host,
      DATABASE_PORT: String(connection.port),
      DATABASE_USER: connection.username,
      DATABASE_PASSWORD: connection.password,
      DATABASE_NAME: databases[1],
      DATABASE_SSL: 'false',
      JWT_SECRET: 'nullable-http-access-secret-at-least-32-chars',
      JWT_EXPIRES_IN: '15m',
      REFRESH_TOKEN_SECRET: 'nullable-http-refresh-secret-at-least-32-chars',
      REFRESH_TOKEN_EXPIRES_IN: '7d',
      WHATSAPP_RESOLVER_TOKEN: 'nullable-http-resolver-token-at-least-32-chars',
      CORS_ORIGIN: 'http://127.0.0.1',
      TRUST_PROXY: 'false',
    });
    const { AppModule } = await import('../src/app.module');
    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: createValidationException,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1');
    try {
      const endpoint = await app.getUrl();
      const current = await app
        .get(AuthService)
        .getCurrentUser(user.id, identity.id, 'headquarters', []);
      assert(current.permissions.includes('itinerary:update'));
      const access = await new JwtService().signAsync(
        {
          sub: user.id,
          identityId: identity.id,
          scope: 'headquarters',
          type: 'access',
          menuKeys: [],
        },
        { secret: process.env.JWT_SECRET, expiresIn: '5m' },
      );
      const request = (method: string, suffix: string, body?: unknown) =>
        fetch(`${endpoint}/api/itineraries/${draft.id}${suffix}`, {
          method,
          headers: {
            Authorization: `Bearer ${access}`,
            'Content-Type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      const data = async <T>(response: Response, status = 200): Promise<T> => {
        assert.equal(response.status, status, await response.clone().text());
        return ((await response.json()) as { data: T }).data;
      };
      const getVersion = async () =>
        (
          await app.get(InquiriesService).itinerary(
            draft.id,
            await app.get(InquiriesService).actor(current, {
              ip: '127.0.0.1',
            } as import('express').Request),
          )
        ).version;
      const nullDraft = priceDraft(null);
      const created = await data<ItineraryInput>(
        await fetch(`${endpoint}/api/inquiries/${inquiry.id}/itineraries`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${access}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(nullDraft),
        }),
        201,
      );
      assert.equal(created.hotelPlans[0].hotels[0].unitCost, null);
      assert.equal(created.guidePlans[0].dailyPrice, null);
      assert(
        created.dailyPlans[0].items.every(
          (item) => item.unitCost === null && item.totalCost === null,
        ),
      );
      const previewBefore = await getVersion();
      const calculation = await data<{
        pricingComplete: boolean;
        missingPrices: string[];
        mealDetails: { unitCost: null; totalCost: null }[];
      }>(await request('POST', '/quote-calculation', nullDraft), 201);
      assert.equal(calculation.pricingComplete, false);
      assert.equal(calculation.missingPrices.length, 4);
      assert.equal(calculation.mealDetails[0].unitCost, null);
      assert.equal(calculation.mealDetails[0].totalCost, null);
      assert.equal(await getVersion(), previewBefore);
      await data(
        await request('PUT', '', { ...nullDraft, version: previewBefore }),
      );
      const restored = await data<ItineraryInput>(await request('GET', ''));
      assert.equal(restored.hotelPlans[0].hotels[0].unitCost, null);
      assert.equal(restored.guidePlans[0].dailyPrice, null);
      for (const item of restored.dailyPlans[0].items) {
        assert.equal(item.unitCost, null);
        assert.equal(item.totalCost, null);
      }
      const copy = await data<ItineraryInput>(
        await request('POST', '/copy', {
          title: 'null copy',
          version: await getVersion(),
        }),
        201,
      );
      assert.equal(copy.hotelPlans[0].hotels[0].unitCost, null);
      assert.equal(copy.guidePlans[0].dailyPrice, null);
      assert(
        copy.dailyPlans[0].items.every(
          (i) => i.unitCost === null && i.totalCost === null,
        ),
      );
      const adjustments: { n: number }[] = await db.query(
        'SELECT count(*)::int n FROM itinerary_price_adjustments WHERE itinerary_id=$1',
        [draft.id],
      );
      assert.equal(adjustments[0].n, 0);
      await assert.rejects(db.undoLastMigration(), { code: '23502' });
      const inquiryVersion = (
        await db.manager.findOneByOrFail(InquiryEntity, { id: inquiry.id })
      ).version;
      for (const [method, suffix] of [
        ['GET', '/pdf-data'],
        ['POST', '/confirm-pdf'],
      ]) {
        const response = await request(
          method,
          suffix,
          method === 'POST'
            ? { version: await getVersion(), inquiryVersion }
            : undefined,
        );
        assert.equal(response.status, 400, await response.clone().text());
        const error = (await response.json()) as {
          code: string;
          details: { issues: string[] };
        };
        assert.equal(error.code, 'PDF_NOT_READY');
        assert.deepEqual(error.details.issues, calculation.missingPrices);
      }
      assert.equal(
        await db.manager.count(ItineraryQuoteEntity, {
          where: { itineraryId: draft.id },
        }),
        0,
      );
      for (const [table, column] of [
        ['itinerary_hotels', 'unit_cost'],
        ['itinerary_guides', 'daily_price'],
        ['itinerary_items', 'unit_cost'],
        ['itinerary_items', 'total_cost'],
      ])
        await assert.rejects(
          db.query(`UPDATE ${table} SET ${column}=-1 WHERE itinerary_id=$1`, [
            draft.id,
          ]),
          { code: '23514' },
        );
      const body = priceDraft();
      const complete = await data<{
        pricingComplete: boolean;
        missingPrices: string[];
        guideCost: string;
      }>(await request('POST', '/quote-calculation', body), 201);
      assert.equal(complete.pricingComplete, true);
      assert.deepEqual(complete.missingPrices, []);
      assert.equal(complete.guideCost, '100.00');
      await data(
        await request('PUT', '', { ...body, version: await getVersion() }),
      );
      await data(
        await request('POST', '/confirm-pdf', {
          version: await getVersion(),
          inquiryVersion,
        }),
        201,
      );
      assert.equal(
        await db.manager.count(ItineraryQuoteEntity, {
          where: { itineraryId: draft.id },
        }),
        1,
      );
      const lines: { unit_price: string }[] = await db.query(
        "SELECT unit_price FROM quote_resource_lines WHERE quote_id=(SELECT id FROM itinerary_quotes WHERE itinerary_id=$1) AND type<>'vehicle'",
        [draft.id],
      );
      assert(
        lines.length === 4 &&
          lines.every((line) => Number(line.unit_price) === 100),
      );
      assert.deepEqual(
        (
          await db.manager.findOneByOrFail(ItineraryQuoteEntity, {
            itineraryId: historical.id,
          })
        ).snapshot,
        structuredClone(frozenBefore),
      );
      console.log(
        `PASS: ${migrationCount} migrations on empty DB, repeat no-op, old prices/freeze unchanged, nullable save/read/copy, HTTP preview, PDF/freeze gate, constraints, safe rollback refusal and priced freeze.`,
      );
    } finally {
      await app.close();
    }
  } finally {
    if (db?.isInitialized) await db.destroy();
    for (const name of databases)
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.destroy();
  }
}
void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
