/** Only the disposable PostgreSQL on localhost:55439; never loads environment files. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Request, Response, NextFunction } from 'express';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import {
  ToursController,
  GuideLeavesController,
} from '../src/tours/tours.controller';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { createValidationException } from '../src/common/validation/validation-exception.factory';
import { DataSource, QueryFailedError } from 'typeorm';
import { FlightsService } from '../src/resources/flights/flights.service';
import { FlightEntity } from '../src/resources/flights/flight.entity';
import { ResourceStatus } from '../src/resources/common/resource.constants';
import { ToursService } from '../src/tours/tours.service';
import { GuideLeavesService } from '../src/tours/guide-leaves.service';
import { WebsiteService } from '../src/website/website.service';
import { InquiriesService } from '../src/inquiries/inquiries.service';
import { AgenciesService } from '../src/resources/agencies/agencies.service';
import { ItineraryValidation } from '../src/inquiries/itinerary-validation';
import { withResourceScope } from '../src/resources/common/resource-scope';
import { effectivePermissions } from '../src/auth/identity-permissions';
import type { AuthenticatedUser } from '../src/auth/auth.types';
import type { BusinessUnit } from '../src/users/user-identity.entity';
import { initTourData } from '../src/scripts/init-tour-dev-data';
import { BusinessException } from '../src/common/exceptions/business.exception';
import type { TourInputDto } from '../src/tours/tour.dto';

type Row = Record<string, unknown>;
const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55439,
  username: 'postgres',
  password: 'isolated-test-only',
};
const admin = new DataSource({ ...connection, database: 'postgres' });
const names = ['tour_check_empty', 'tour_check_old'];
const source = (database: string) =>
  new DataSource({
    ...connection,
    database,
    entities: ['src/**/*.entity.ts'],
    migrations: ['src/migrations/*.ts'],
    synchronize: false,
  });
let db: DataSource;
let count = 0;
async function check(name: string, test: () => Promise<void>) {
  await test();
  count++;
  console.log(`PASS ${name}`);
}
async function rejects(action: Promise<unknown>, code: string) {
  await assert.rejects(
    action,
    (e) =>
      e instanceof BusinessException &&
      (e.getResponse() as { code: string }).code === code,
  );
}
async function user(
  scope: BusinessUnit,
  username: string,
  code = 'AS',
  roles = ['COORDINATOR'],
): Promise<AuthenticatedUser> {
  const id = randomUUID();
  const identityId = randomUUID();
  await db.query(
    `INSERT INTO users(id,username,password_hash,nickname,english_name,tour_code) VALUES($1,$2,'test-only',$2,$2,$3)`,
    [id, username, code],
  );
  await db.query(
    'INSERT INTO user_identities(id,user_id,username,scope) VALUES($1,$2,$3,$4)',
    [identityId, id, username, scope],
  );
  await db.query(
    `INSERT INTO identity_roles(identity_id,role_id) SELECT $1,id FROM roles WHERE code=ANY($2::text[])`,
    [identityId, roles],
  );
  return {
    id,
    identityId,
    username,
    nickname: username,
    scope,
    scopeName: scope,
    deptId: null,
    deptName: '',
    roles,
    permissions: effectivePermissions(scope, roles),
    resourceLibrary: scope === 'shengxu' ? 'shengxu' : 'shared',
  };
}
async function fixture(
  owner: AuthenticatedUser,
  module: 'standard' | 'website',
  start = '2026-09-05',
  inquiryId = randomUUID(),
  downloaded = false,
) {
  const itineraryId = randomUUID();
  const quoteId = randomUUID();
  const code = randomUUID();
  const [country] = await db.query<{ id: string }[]>(
    `SELECT id FROM system_business_dictionary_items WHERE code='MYS'`,
  );
  if (module === 'website') {
    await db.query(
      `INSERT INTO website_inquiries(id,code,customer_name,planned_days,requirements,owner_id,owner,status,country_item_id,country_code,country_or_region) VALUES($1,$2,'Agency',2,'',$3,$4,'quoted',$5,'MYS','马来西亚') ON CONFLICT(id) DO NOTHING`,
      [inquiryId, code, owner.id, owner.nickname, country.id],
    );
    await db.query(
      `INSERT INTO website_itineraries(id,inquiry_id,code,title,duration,start_date,config_version,status) VALUES($1,$2,$3,'Test',2,$4,0,'quoted')`,
      [itineraryId, inquiryId, code, start || null],
    );
    await db.query(
      `INSERT INTO website_quotations(id,itinerary_id,code,snapshot,confirmed_by,first_downloaded_at,confirmed_at) VALUES($1,$2,$3,$4::jsonb,$5,CASE WHEN $6 THEN now() ELSE NULL END,clock_timestamp())`,
      [
        quoteId,
        itineraryId,
        code,
        JSON.stringify({
          id: quoteId,
          immutable: 'website',
          itinerary: { startDate: start, days: 2 },
        }),
        owner.id,
        downloaded,
      ],
    );
  } else {
    await db.query(
      `INSERT INTO inquiries(id,code,owner_id,owner,status,creator,business_unit,agency_id,contact_id,agency_code,agency_name,contact_name,email,phone,country_or_region,source_channel,original_message,internal_remark,planned_days,lost_reason,country_item_id,country_code) VALUES($1,$2,$3,$4,'quoted',$4,$5,$6,$7,'AGY-X','Agency','Contact','','','马来西亚','','','',2,'',$8,'MYS') ON CONFLICT(id) DO NOTHING`,
      [
        inquiryId,
        code,
        owner.id,
        owner.nickname,
        owner.scope,
        randomUUID(),
        randomUUID(),
        country.id,
      ],
    );
    await db.query(
      `INSERT INTO itineraries(id,inquiry_id,code,creator,title,start_date,pax_tiers,status) VALUES($1,$2,$3,$4,'Test',$5,'{10}','quoted')`,
      [itineraryId, inquiryId, code, owner.nickname, start],
    );
    await db.query(
      `INSERT INTO itinerary_quotes(id,itinerary_id,source_version,created_by,snapshot,quote_code,quote_version,inquiry_id,inquiry_version,daily_resource_cost,guide_cost,first_downloaded_at,created_at) VALUES($1,$2,1,$3,$4::jsonb,$5,1,$6,1,0,0,CASE WHEN $7 THEN now() ELSE NULL END,clock_timestamp())`,
      [
        quoteId,
        itineraryId,
        owner.id,
        JSON.stringify({
          immutable: 'standard',
          itinerary: { code, startDate: start, days: 2 },
          calculation: { historical: true },
        }),
        code,
        inquiryId,
        downloaded,
      ],
    );
  }
  return { sourceModule: module, inquiryId, quoteId, itineraryId };
}
async function main() {
  await admin.initialize();
  try {
    for (const name of names) await admin.query(`CREATE DATABASE "${name}"`);
    db = await source(names[0]).initialize();
    await check('empty full migration chain + rerun', async () => {
      assert.equal((await db.runMigrations()).length, db.migrations.length);
      assert.equal((await db.runMigrations()).length, 0);
    });
    await db.destroy();
    db = await source(names[1]).initialize();
    const added = db.migrations.filter((m) =>
      [
        'AddTourManagement1791452400000',
        'RefineTourFlightConstraints1791532800000',
      ].includes(m.name!),
    );
    db.migrations.splice(
      0,
      db.migrations.length,
      ...db.migrations.filter((m) => !added.includes(m)),
    );
    await db.runMigrations();
    const legacyId = randomUUID();
    await db.query(
      `INSERT INTO users(id,username,password_hash,nickname) VALUES($1,'legacy','test-only','Legacy')`,
      [legacyId],
    );
    const [legacyFlight] = await db.query<{ id: string }[]>(
      `INSERT INTO resource_flights(library,departure_city,arrival_city,flight_number,departure_time,arrival_time) VALUES('shengxu','上海','昆明','MU5820','01:00','02:00') RETURNING id`,
    );
    // Existing frozen payloads are intentionally incomplete and remain byte-for-byte unchanged.
    await db.query(
      `INSERT INTO inquiries(code,owner_id,owner,creator,business_unit,agency_id,contact_id,agency_code,agency_name,contact_name,email,phone,country_or_region,source_channel,original_message,internal_remark,planned_days,lost_reason) VALUES('IQ-OLD',$1,'Legacy','Legacy','shengxu',$2,$3,'OLD','OLD','','','','unmatched','','','',1,'')`,
      [legacyId, randomUUID(), randomUUID()],
    );
    const [oldInquiry] = await db.query<{ id: string }[]>(
      `SELECT id FROM inquiries WHERE code='IQ-OLD'`,
    );
    const [oldPlan] = await db.query<{ id: string }[]>(
      `INSERT INTO itineraries(inquiry_id,code,creator,title,start_date,pax_tiers,status) VALUES($1,'IT-OLD','Legacy','Old','2020-01-01','{10}','quoted') RETURNING id`,
      [oldInquiry.id],
    );
    await db.query(
      `INSERT INTO itinerary_quotes(itinerary_id,source_version,created_by,snapshot,quote_code,quote_version,inquiry_id,inquiry_version,daily_resource_cost,guide_cost) VALUES($1,1,$2,'{"unchanged":"历史"}', 'QT-OLD',1,$3,1,0,0)`,
      [oldPlan.id, legacyId, oldInquiry.id],
    );
    db.migrations.push(...added);
    await check(
      'old data incremental migrations preserve IDs/text/freeze and backfill English',
      async () => {
        assert.equal((await db.runMigrations()).length, 2);
        assert.equal((await db.runMigrations()).length, 0);
        const [u] = await db.query<
          { english_name: string; tour_code: string | null }[]
        >('SELECT english_name,tour_code FROM users WHERE id=$1', [legacyId]);
        assert.deepEqual(u, { english_name: 'legacy', tour_code: null });
        const [f] = await db.query<
          { departure_city: string; departure_airport_id: string | null }[]
        >(
          'SELECT departure_city,departure_airport_id FROM resource_flights WHERE id=$1',
          [legacyFlight.id],
        );
        assert.deepEqual(f, {
          departure_city: '上海',
          departure_airport_id: null,
        });
        assert.deepEqual(
          (
            await db.query<{ snapshot: Row }[]>(
              `SELECT snapshot FROM itinerary_quotes WHERE quote_code='QT-OLD'`,
            )
          )[0].snapshot,
          { unchanged: '历史' },
        );
      },
    );
    const sxManager = await user('shengxu', 'manager', 'MG', [
      'BUSINESS_MANAGER',
    ]);
    const sx = await user('shengxu', 'caolanyi', 'MANUAL');
    const sx2 = await user('shengxu', 'other', 'AS');
    const web = await user('website', 'houyue', 'AS');
    const linxi = await user('linxi', 'linxi', 'AS');
    const web2 = await user('website', 'other', 'AS');
    const manager = await user('website', 'manager', 'MG', [
      'BUSINESS_MANAGER',
    ]);
    const stranger = await user('website', 'stranger');
    await db.query('UPDATE users SET tour_code=NULL WHERE id=$1', [web.id]);
    await check(
      'initialisation is idempotent and preserves manual/default scope values',
      async () => {
        const first = await db.transaction(initTourData);
        const second = await db.transaction(initTourData);
        assert.equal((first.airports as { inserted: number }).inserted, 28);
        assert.equal((second.airports as { inserted: number }).inserted, 0);
        assert.equal(second.flightUpdates, 0);
        assert.deepEqual(second.tourCodesApplied, []);
        assert.equal(
          (
            await db.query<{ tour_code: string }[]>(
              'SELECT tour_code FROM users WHERE id=$1',
              [sx.id],
            )
          )[0].tour_code,
          'MANUAL',
        );
        assert.equal(
          (
            await db.query<{ tour_code: string }[]>(
              'SELECT tour_code FROM users WHERE id=$1',
              [web.id],
            )
          )[0].tour_code,
          'HY',
        );
        assert.deepEqual(
          (
            await db.query<{ snapshot: Row }[]>(
              `SELECT snapshot FROM itinerary_quotes WHERE quote_code='QT-OLD'`,
            )
          )[0].snapshot,
          { unchanged: '历史' },
        );
      },
    );
    await db.query(`UPDATE users SET tour_code='AS' WHERE id=ANY($1::uuid[])`, [
      [sx.id, web.id],
    ]);
    const [airport] = await db.query<{ id: string }[]>(
      `SELECT id FROM system_business_dictionary_items WHERE code='KMG'`,
    );
    const flight = async (library: string, departure = '02:30') =>
      (
        await db.query<{ id: string }[]>(
          `INSERT INTO resource_flights(library,departure_city,arrival_city,flight_number,departure_time,arrival_time,departure_airport_id,arrival_airport_id) VALUES($1,'old city','old city',$2,$3,'10:00',$4,$4) RETURNING id`,
          [
            library,
            randomUUID().slice(0, 8).toUpperCase(),
            departure,
            airport.id,
          ],
        )
      )[0].id;
    await check(
      'airport-specific flight uniqueness, English/IATA search and dictionary reference validation',
      async () => {
        const items = await db.query<{ id: string; code: string }[]>(
          `SELECT id,code FROM system_business_dictionary_items WHERE code IN ('PVG','SHA','MYS')`,
        );
        const pvg = items.find((i) => i.code === 'PVG')!.id;
        const sha = items.find((i) => i.code === 'SHA')!.id;
        const mys = items.find((i) => i.code === 'MYS')!.id;
        for (const airportId of [pvg, sha])
          await db.query(
            `INSERT INTO resource_flights(library,departure_city,arrival_city,flight_number,departure_time,arrival_time,departure_airport_id,arrival_airport_id) VALUES('shengxu','上海','昆明','MU1234','08:00','10:00',$1,$2)`,
            [airportId, airport.id],
          );
        const api = new FlightsService(db.getRepository(FlightEntity), db);
        const result = await withResourceScope(sx, 'shengxu', () =>
          api.list({ page: 1, pageSize: 20, keyword: 'Pudong' }),
        );
        assert.equal(result.total, 1);
        assert.equal(result.list[0].departureAirport?.code, 'PVG');
        assert.equal(
          (
            await withResourceScope(sx, 'shengxu', () =>
              api.list({
                page: 1,
                pageSize: 20,
                keyword: 'SHA',
                departureAirportId: sha,
                arrivalAirportId: airport.id,
              }),
            )
          ).list[0].departureAirport?.code,
          'SHA',
        );
        await rejects(
          withResourceScope(sx, 'shengxu', () =>
            api.create(
              {
                departureAirportId: mys,
                arrivalAirportId: airport.id,
                flightNumber: 'BAD',
                departureTime: '08:00',
                arrivalTime: '10:00',
                status: ResourceStatus.Enabled,
              },
              sx.id,
            ),
          ),
          'VALIDATION_ERROR',
        );
        await assert.rejects(
          db.query(
            `INSERT INTO resource_flights(library,departure_city,arrival_city,flight_number,departure_time,arrival_time,departure_airport_id,arrival_airport_id) VALUES('shengxu','other','other','MU1234','08:00','10:00',$1,$2)`,
            [pvg, airport.id],
          ),
          (e) =>
            e instanceof QueryFailedError &&
            (e.driverError as { code: string }).code === '23505',
        );
      },
    );
    const shared = await flight('shared');
    const shengxu = await flight('shengxu');
    const guide = async (library: string) =>
      (
        await db.query<{ id: string }[]>(
          `INSERT INTO resource_guide_people(code,name,library) VALUES($1,'Test Guide',$2) RETURNING id`,
          [randomUUID(), library],
        )
      )[0].id;
    const g = await guide('shared');
    const g2 = await guide('shared');
    const input = (
      owner: AuthenticatedUser,
      guideId: string | null = null,
    ): TourInputDto => ({
      operatorId: owner.id,
      adults: 2,
      children: 1,
      leaders: 1,
      language: 'English',
      shopping: false,
      pickupFlightId: owner.scope === 'shengxu' ? shengxu : shared,
      dropFlightId: owner.scope === 'shengxu' ? shengxu : shared,
      guideId,
      remark: '',
    });
    const tours = new ToursService(db);
    const leaves = new GuideLeavesService(db);
    const website = new WebsiteService(db);
    const inquiries = new InquiriesService(
      db,
      {} as ItineraryValidation,
      {} as AgenciesService,
    );
    const actor = (u: AuthenticatedUser) => ({
      ...u,
      name: u.nickname,
      admin: u.roles.includes('BUSINESS_MANAGER'),
      ip: '',
      requestId: 'test',
    });
    const create = (
      src: Awaited<ReturnType<typeof fixture>>,
      u: AuthenticatedUser,
      guideId: string | null = null,
    ) => tours.create({ ...src, ...input(u, guideId) }, u);
    const one = await fixture(web, 'website');
    await check(
      'freeze without download is ineligible; reads do not mark; repeat click retains first time',
      async () => {
        await rejects(create(one, web), 'CONFLICT');
        await website.quotation(one.itineraryId, web);
        assert.equal(
          (
            await db.query<{ first_downloaded_at: unknown }[]>(
              'SELECT first_downloaded_at FROM website_quotations WHERE id=$1',
              [one.quoteId],
            )
          )[0].first_downloaded_at,
          null,
        );
        const first = await website.recordDownload(one.itineraryId, web);
        const repeat = await website.recordDownload(one.itineraryId, web);
        assert.deepEqual(first, repeat);
      },
    );
    const latest = await fixture(web, 'website', '2026-09-05', one.inquiryId);
    await check(
      'old downloaded quote cannot bypass latest undownloaded',
      async () => {
        await rejects(create(one, web), 'CONFLICT');
        await rejects(create(latest, web), 'CONFLICT');
        await website.recordDownload(latest.itineraryId, web);
      },
    );
    let t: Row = {};
    await check(
      'concurrent duplicate tour creation has exactly one winner',
      async () => {
        const results = await Promise.allSettled([
          create(latest, web, g),
          create(latest, web, g),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        t = (
          results.find(
            (r) => r.status === 'fulfilled',
          ) as PromiseFulfilledResult<Row>
        ).value;
        assert.equal(t.dropAt, '2026-09-06 23:30');
        assert.equal(t.totalPeople, 4);
        assert.equal(t.tourNo, 'KMLX-260905AS1-MYS');
      },
    );
    await check(
      'active tour blocks all website write entry points',
      async () => {
        const actions = [
          website.update(one.inquiryId, {} as never, web),
          website.archive(one.inquiryId, 1, manager),
          website.transfer(
            one.inquiryId,
            { ownerId: web2.id, version: 1, reason: 'test' },
            manager,
          ),
          website.createItinerary(one.inquiryId, {} as never, web),
          website.saveItinerary(latest.itineraryId, {} as never, web),
          website.copyItinerary(latest.itineraryId, 1, web),
          website.generate(latest.itineraryId, 1, randomUUID(), web),
        ];
        await Promise.all(
          actions.map((action) => rejects(action, 'INQUIRY_READ_ONLY')),
        );
        assert.equal(
          (await website.confirm(latest.itineraryId, {} as never, web)).id,
          latest.quoteId,
        );
      },
    );
    await check(
      'leave endpoints are inclusive; other library cannot access or delete',
      async () => {
        await rejects(
          withResourceScope(web, 'shared', () =>
            leaves.create(
              {
                guidePersonId: g,
                startDate: '2026-09-06',
                endDate: '2026-09-06',
                reason: '',
                remark: '',
              },
              web.id,
            ),
          ),
          'CONFLICT',
        );
        const l = await withResourceScope(web, 'shared', () =>
          leaves.create(
            {
              guidePersonId: g,
              startDate: '2026-09-07',
              endDate: '2026-09-08',
              reason: '',
              remark: '',
            },
            web.id,
          ),
        );
        await rejects(
          withResourceScope(sx, 'shengxu', () => leaves.get(l.id as string)),
          'RESOURCE_NOT_FOUND',
        );
        await rejects(
          withResourceScope(sx, 'shengxu', () =>
            leaves.delete([l.id as string], sx.id),
          ),
          'RESOURCE_NOT_FOUND',
        );
      },
    );
    const otherScope = await fixture(
      linxi,
      'standard',
      '2026-09-04',
      randomUUID(),
      true,
    );
    await check(
      'same shared guide cannot overlap between website and linxi; conflict has no foreign details',
      async () => {
        await assert.rejects(
          create(otherScope, linxi, g),
          (e) =>
            e instanceof BusinessException &&
            (e.getResponse() as { message: string }).message ===
              '导游在该时段已有其他团期',
        );
      },
    );
    await check(
      '0 is a real rating and locks assigned guide; arbitrary base columns allowed',
      async () => {
        const r = await tours.saveRating(
          t.id as string,
          { version: 0, selfScore: 0, managerScore: 80 },
          web,
        );
        assert.equal(r.average, 40);
        await rejects(
          tours.update(
            t.id as string,
            { ...input(web, null), version: t.version as number },
            web,
          ),
          'CONFLICT',
        );
        await rejects(
          tours.saveRating(t.id as string, { version: 1, praise: 61 }, web),
          'VALIDATION_ERROR',
        );
      },
    );
    await check(
      'rating version concurrency preserves the winning row; scope and roles enforced',
      async () => {
        const results = await Promise.allSettled([
          tours.saveRating(
            t.id as string,
            { version: 1, collectScore: 90 },
            web,
          ),
          tours.saveRating(
            t.id as string,
            { version: 1, operatorScore: 90 },
            manager,
          ),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        await rejects(
          tours.saveRating(
            t.id as string,
            { version: 2, selfScore: 99 },
            stranger,
          ),
          'AUTH_FORBIDDEN',
        );
        await rejects(
          tours.saveRating(
            t.id as string,
            { version: 2, selfScore: 99 },
            linxi,
          ),
          'NOT_FOUND',
        );
      },
    );
    await check(
      'master time edits and creator code edits preserve booked dates/number/snapshots',
      async () => {
        await db.query(
          `UPDATE resource_flights SET departure_time='12:00',arrival_time='23:00' WHERE id=$1`,
          [shared],
        );
        await db.query(`UPDATE users SET tour_code='NEW' WHERE id=$1`, [
          web.id,
        ]);
        const updated = await tours.update(
          t.id as string,
          { ...input(web, g), version: 1, remark: 'changed' },
          web,
        );
        assert.equal(updated.dropAt, t.dropAt);
        assert.equal(updated.pickupAt, t.pickupAt);
        assert.deepEqual(updated.pickupFlight, t.pickupFlight);
        assert.equal(updated.tourNo, t.tourNo);
        t = updated;
        const available = await tours.availableGuides(
          {
            businessUnit: 'website',
            startDate: '2026-09-05',
            days: 2,
            pickupFlightId: shared,
            dropFlightId: shared,
            excludeTourId: t.id as string,
          },
          web,
        );
        assert(available.some((r) => r.id === g));
      },
    );
    await check(
      'cancel releases occupancy, keeps rating and numbering, cannot restore',
      async () => {
        await tours.cancel(
          t.id as string,
          { version: t.version as number, reason: 'test' },
          web,
        );
        await rejects(
          tours.update(t.id as string, { ...input(web, g), version: 3 }, web),
          'CONFLICT',
        );
        const r = await tours.ratings({ page: 1, pageSize: 20 }, web);
        assert.equal(r.list.find((x) => x.tourId === t.id)?.selfScore, 0);
        const copied = await website.copyItinerary(latest.itineraryId, 1, web);
        assert.equal(copied.status, 'draft');
        const existingLeaves = await withResourceScope(web, 'shared', () =>
          leaves.list({ page: 1, pageSize: 20, guidePersonId: g }),
        );
        await withResourceScope(web, 'shared', () =>
          leaves.delete(
            existingLeaves.list.map((l) => l.id as string),
            web.id,
          ),
        );
        const replacement = await create(latest, web, g);
        assert.notEqual(replacement.tourNo, t.tourNo);
        assert.equal(
          (await tours.ratings({ page: 1, pageSize: 20 }, web)).list.find(
            (r) => r.tourId === replacement.id,
          )?.version,
          0,
        );
        await tours.cancel(
          replacement.id as string,
          { version: 1, reason: '' },
          web,
        );
      },
    );
    await check(
      'different creators sharing code receive collision suffix; own concurrent sequence is atomic',
      async () => {
        const a = await fixture(
          sx,
          'standard',
          '2026-11-10',
          randomUUID(),
          true,
        );
        const b = await fixture(
          sx2,
          'standard',
          '2026-11-10',
          randomUUID(),
          true,
        );
        const two = await Promise.all([create(a, sx), create(b, sx2)]);
        const numbers = two.map((t) => t.tourNo).sort();
        assert.deepEqual(
          numbers,
          ['YNSS-261110AS(1)1-MYS', 'YNSS-261110AS1-MYS'].sort(),
        );
        const c = await fixture(
          sx,
          'standard',
          '2026-11-10',
          randomUUID(),
          true,
        );
        const d = await fixture(
          sx,
          'standard',
          '2026-11-10',
          randomUUID(),
          true,
        );
        const more = await Promise.all([create(c, sx), create(d, sx)]);
        assert.deepEqual(more.map((t) => t.tourNo).sort(), [
          'YNSS-261110AS2-MYS',
          'YNSS-261110AS3-MYS',
        ]);
      },
    );
    const standard = await fixture(sx, 'standard', '2026-11-20');
    await check(
      'standard download evidence and all source write locks',
      async () => {
        await rejects(create(standard, sx), 'CONFLICT');
        const before = await db.query<{ snapshot: Row }[]>(
          'SELECT snapshot FROM itinerary_quotes WHERE id=$1',
          [standard.quoteId],
        );
        const first = await inquiries.recordDownload(
          standard.itineraryId,
          actor(sx),
        );
        assert.deepEqual(
          await inquiries.recordDownload(standard.itineraryId, actor(sx)),
          first,
        );
        const st = await create(standard, sx);
        const actions = [
          inquiries.update(standard.inquiryId, {} as never, actor(sx)),
          inquiries.archive(standard.inquiryId, 1, actor(sxManager)),
          inquiries.createItinerary(standard.inquiryId, {} as never, actor(sx)),
          inquiries.saveItinerary(standard.itineraryId, {} as never, actor(sx)),
          inquiries.copy(standard.itineraryId, {} as never, actor(sx)),
          inquiries.transfer(
            standard.inquiryId,
            { ownerId: sx2.id, version: 1, reason: 'test' },
            actor(sxManager),
          ),
          inquiries.confirmPdf(standard.itineraryId, {} as never, actor(sx)),
        ];
        await Promise.all(
          actions.map((action) => rejects(action, 'INQUIRY_READ_ONLY')),
        );
        assert.equal(
          (await inquiries.detail(standard.inquiryId, actor(sx))).hasActiveTour,
          true,
        );
        assert.deepEqual(
          await db.query('SELECT snapshot FROM itinerary_quotes WHERE id=$1', [
            standard.quoteId,
          ]),
          before,
        );
        await tours.cancel(st.id as string, { version: 1, reason: '' }, sx);
        assert.equal(
          (await inquiries.detail(standard.inquiryId, actor(sx))).hasActiveTour,
          false,
        );
      },
    );
    await check(
      'leave/tour race and simultaneous tour assignment have only one winner',
      async () => {
        const src = await fixture(
          web2,
          'website',
          '2026-12-10',
          randomUUID(),
          true,
        );
        const race = await Promise.allSettled([
          create(src, web2, g2),
          withResourceScope(web2, 'shared', () =>
            leaves.create(
              {
                guidePersonId: g2,
                startDate: '2026-12-10',
                endDate: '2026-12-13',
                reason: '',
                remark: '',
              },
              web2.id,
            ),
          ),
        ]);
        assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
        const gg = await guide('shared');
        const s1 = await fixture(
          web,
          'website',
          '2027-01-01',
          randomUUID(),
          true,
        );
        const s2 = await fixture(
          web2,
          'website',
          '2027-01-02',
          randomUUID(),
          true,
        );
        const two = await Promise.allSettled([
          create(s1, web, gg),
          create(s2, web2, gg),
        ]);
        assert.equal(two.filter((r) => r.status === 'fulfilled').length, 1);
      },
    );
    await check(
      'missing start/country and no-guide ratings reject; lists paginate and isolate',
      async () => {
        const src = await fixture(web, 'website', '', randomUUID(), true);
        await rejects(create(src, web), 'VALIDATION_ERROR');
        const other = await fixture(
          web,
          'website',
          '2027-02-01',
          randomUUID(),
          true,
        );
        await db.query(
          'UPDATE website_inquiries SET country_item_id=NULL,country_code=NULL WHERE id=$1',
          [other.inquiryId],
        );
        await rejects(create(other, web), 'VALIDATION_ERROR');
        const ng = await fixture(
          web,
          'website',
          '2027-02-03',
          randomUUID(),
          true,
        );
        const nt = await create(ng, web);
        await rejects(
          tours.saveRating(nt.id as string, { version: 0, selfScore: 0 }, web),
          'CONFLICT',
        );
        const list = await tours.list({ page: 1, pageSize: 1 }, web);
        assert.equal(list.list.length, 1);
        assert(list.total > 1);
        assert.equal(list.list[0].businessUnit, 'website');
      },
    );
    await check(
      'HTTP routes, permission metadata, DTO validation and response envelopes',
      async () => {
        const module = await Test.createTestingModule({
          controllers: [ToursController, GuideLeavesController],
          providers: [
            ToursService,
            GuideLeavesService,
            { provide: DataSource, useValue: db },
          ],
        }).compile();
        const app = module.createNestApplication({ logger: false });
        app.setGlobalPrefix('api');
        const reflector = new Reflector();
        app.use(
          (
            req: Request & { user?: AuthenticatedUser },
            _res: Response,
            next: NextFunction,
          ) => {
            req.user =
              req.headers['x-test-actor'] === 'shengxu'
                ? sx
                : req.headers['x-test-actor'] === 'readonly'
                  ? { ...web, permissions: ['tour:list'], roles: ['EXECUTIVE'] }
                  : web;
            next();
          },
        );
        app.useGlobalGuards(new PermissionsGuard(reflector));
        app.useGlobalPipes(
          new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true,
            exceptionFactory: createValidationException,
          }),
        );
        app.useGlobalFilters(new ApiExceptionFilter());
        app.useGlobalInterceptors(new ResponseInterceptor(reflector));
        await app.listen(0, '127.0.0.1');
        try {
          const endpoint = await app.getUrl();
          const page = await fetch(`${endpoint}/api/tours?pageSize=1`);
          assert.equal(page.status, 200);
          const body = (await page.json()) as {
            code: string;
            data: { list: Row[]; pageSize: number };
          };
          assert.equal(body.code, 'SUCCESS');
          assert.equal(body.data.pageSize, 1);
          assert.equal(body.data.list.length, 1);
          assert.equal(
            (
              await fetch(
                `${endpoint}/api/tours/operators?businessUnit=invalid`,
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await fetch(`${endpoint}/api/tours/ratings/${t.id as string}`, {
                method: 'PUT',
                headers: {
                  'content-type': 'application/json',
                  'x-test-actor': 'readonly',
                },
                body: JSON.stringify({ version: 2, selfScore: 90 }),
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await fetch(`${endpoint}/api/tours`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sourceModule: 'guessed' }),
              })
            ).status,
            400,
          );
          const cross = await fetch(`${endpoint}/api/tours/${t.id as string}`, {
            headers: { 'x-test-actor': 'shengxu' },
          });
          assert.equal(cross.status, 404);
        } finally {
          await app.close();
        }
      },
    );
    console.log(
      JSON.stringify({
        checks: count,
        migrations: db.migrations.length,
        result: 'PASS',
      }),
    );
  } finally {
    if (db?.isInitialized) await db.destroy();
    for (const name of names)
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.destroy();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
