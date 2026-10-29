/** Real HTTP/guards/migrations on a disposable database; never loads .env. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  IsolationHarness,
  Actor,
  RecordRef,
} from './business-isolation.harness';
import { AddInquirySoftDelete1794355200000 } from '../src/migrations/1794355200000-AddInquirySoftDelete';

type Inquiry = RecordRef & { code: string; canDelete: boolean };
const h = new IsolationHarness();
let countryId: string;
let root: Actor;
let flights: string[];

async function create(
  unit: string,
  actor: Actor,
  owner = actor,
): Promise<Inquiry> {
  if (unit !== 'shengxu')
    return h.call(
      actor,
      'POST',
      '/website/inquiries',
      {
        countryItemId: countryId,
        customerName: randomUUID(),
        requirements: 'Delete fixture',
        plannedDays: 1,
        ...(actor === root ? { businessUnit: unit, ownerId: owner.id } : {}),
      },
      201,
    );
  const agencyId = randomUUID(),
    contactId = randomUUID();
  await h.db.query(
    `INSERT INTO resource_agencies(id,code,name,business_unit,coordinator_id,country_or_region,city,country_item_id)
    VALUES($1,next_business_code('AGY'),'Delete fixture','shengxu',$2,'Malaysia','Kunming',$3)`,
    [agencyId, owner.id, countryId],
  );
  await h.db.query(
    `INSERT INTO resource_agency_contacts(id,agency_id,name,name_key) VALUES($1,$2,'Contact','contact')`,
    [contactId, agencyId],
  );
  return h.call(
    actor,
    'POST',
    '/inquiries',
    {
      agencyId,
      contactId,
      countryItemId: countryId,
      plannedDays: 1,
      sourceChannel: 'Email',
      originalMessage: 'Delete fixture',
      ...(actor === root ? { businessUnit: unit } : {}),
    },
    201,
  );
}

async function frozen(unit: string, row: Inquiry, actor: Actor) {
  const planId = randomUUID(),
    quoteId = randomUUID();
  if (unit === 'shengxu') {
    await h.db.query(
      `INSERT INTO itineraries(id,inquiry_id,code,creator,title,start_date,pax_tiers,status)
      VALUES($1,$2,$3,'Fixture','Delete fixture','2030-01-01','{10}','quoted')`,
      [planId, row.id, `IT-${planId}`],
    );
    await h.db.query(
      `INSERT INTO itinerary_quotes(id,itinerary_id,source_version,created_by,snapshot,quote_code,quote_version,inquiry_id,inquiry_version,daily_resource_cost,guide_cost,first_downloaded_at)
      VALUES($1,$2,1,$3,$4::jsonb,$5,1,$6,1,0,0,now())`,
      [
        quoteId,
        planId,
        actor.id,
        JSON.stringify({
          itinerary: { code: `IT-${planId}`, startDate: '2030-01-01', days: 1 },
          calculation: {},
        }),
        `QT-${quoteId}`,
        row.id,
      ],
    );
  } else {
    await h.db.query(
      `INSERT INTO website_itineraries(id,inquiry_id,code,title,duration,start_date,config_version,status,business_unit)
      VALUES($1,$2,$3,'Delete fixture',1,'2030-01-01',(SELECT version FROM website_config_current WHERE business_unit=$4),'quoted',$4)`,
      [planId, row.id, `WIT-${planId}`, unit],
    );
    await h.db.query(
      `INSERT INTO website_quotations(id,itinerary_id,code,snapshot,confirmed_by,first_downloaded_at)
      VALUES($1,$2,$3,$4::jsonb,$5,now())`,
      [
        quoteId,
        planId,
        `WQT-${quoteId}`,
        JSON.stringify({
          itinerary: {
            code: `WIT-${planId}`,
            startDate: '2030-01-01',
            days: 1,
          },
        }),
        actor.id,
      ],
    );
  }
  return { planId, quoteId };
}

async function main() {
  try {
    await h.start();
    root = await h.actor('headquarters', 'ROOT');
    const admin = await h.actor('headquarters', 'ADMIN');
    const executive = await h.actor('headquarters', 'EXECUTIVE');
    [{ id: countryId }] = await h.db.query<
      { id: string }[]
    >(`INSERT INTO system_business_dictionary_items(type_id,code,name,english_name)
      SELECT id,'MYS','Malaysia','Malaysia' FROM system_business_dictionary_types WHERE code='country-region' RETURNING id`);
    const airports = await h.db.query<
      { id: string }[]
    >(`INSERT INTO system_business_dictionary_items(type_id,code,name,english_name)
      SELECT t.id,v.code,v.code,v.code FROM system_business_dictionary_types t CROSS JOIN (VALUES('KMG'),('PVG')) v(code) WHERE t.code='city-airport' RETURNING id`);
    flights = [];
    for (const [index, departure, arrival] of [
      [0, '07:00', '08:00'],
      [1, '18:00', '19:00'],
    ] as const) {
      const id = randomUUID();
      flights.push(id);
      await h.db.query(
        `INSERT INTO resource_flights(id,departure_city,arrival_city,flight_number,departure_time,arrival_time,departure_airport_id,arrival_airport_id)
        VALUES($1,'A','B',$2,$3,$4,$5,$6)`,
        [
          id,
          `DEL${index}`,
          departure,
          arrival,
          airports[index].id,
          airports[1 - index].id,
        ],
      );
    }
    const actors = new Map<string, { a: Actor; b: Actor; manager: Actor }>();
    for (const unit of ['shengxu', 'linxi', 'website'] as const) {
      const a = await h.actor(unit),
        b = await h.actor(unit),
        manager = await h.actor(unit, 'BUSINESS_MANAGER');
      actors.set(unit, { a, b, manager });
    }
    // Upgrade representative old rows without changing business data or historical logs.
    await create('website', actors.get('website')!.a);
    const historical = await create('website', actors.get('website')!.a);
    await h.db.query(
      "UPDATE website_inquiries SET status='lost',lost_reason='Fixture' WHERE id=$1",
      [historical.id],
    );
    const before = await h.db.query<Record<string, unknown>[]>(
      'SELECT id,code,owner_id,version,status FROM website_inquiries ORDER BY id',
    );
    await h.db.query(
      'ALTER TABLE inquiries DROP COLUMN deleted_at; ALTER TABLE website_inquiries DROP COLUMN deleted_at',
    );
    const runner = h.db.createQueryRunner();
    try {
      await new AddInquirySoftDelete1794355200000().up(runner);
    } finally {
      await runner.release();
    }
    assert.deepEqual(
      await h.db.query(
        'SELECT id,code,owner_id,version,status FROM website_inquiries ORDER BY id',
      ),
      before,
    );
    assert.equal(
      (
        await h.db.query<{ n: number }[]>(
          'SELECT count(*)::int AS n FROM website_inquiries WHERE deleted_at IS NOT NULL',
        )
      )[0].n,
      0,
    );
    assert.equal((await h.db.runMigrations()).length, 0);
    console.log(
      'PASS old schema upgrade preserves business rows; migration repeat no-op',
    );
    for (const unit of ['shengxu', 'linxi', 'website'] as const) {
      const { a, b, manager } = actors.get(unit)!;
      const prefix = unit === 'shengxu' ? '/inquiries' : '/website/inquiries';
      const table = unit === 'shengxu' ? 'inquiries' : 'website_inquiries';
      const planPrefix =
        unit === 'shengxu' ? '/itineraries' : '/website/itineraries';
      const logPrefix =
        unit === 'shengxu' ? '/inquiry-logs' : '/website/inquiry-logs';
      const sourceModule = unit === 'shengxu' ? 'standard' : 'website';
      const own = await create(unit, a);
      assert.equal(own.canDelete, true);
      await h.call(
        a,
        'DELETE',
        `${prefix}/${own.id}`,
        {},
        400,
        'VALIDATION_ERROR',
      );
      await h.call(
        a,
        'DELETE',
        `${prefix}/${own.id}`,
        { version: own.version, ownerId: a.id },
        400,
        'VALIDATION_ERROR',
      );
      await h.call(
        a,
        'DELETE',
        `${prefix}/${own.id}`,
        { version: 99 },
        409,
        'INQUIRY_VERSION_CONFLICT',
      );
      for (const reader of [admin, executive]) {
        assert.equal(
          (await h.call<Inquiry>(reader, 'GET', `${prefix}/${own.id}`))
            .canDelete,
          false,
        );
        await h.call(
          reader,
          'DELETE',
          `${prefix}/${own.id}`,
          { version: own.version },
          403,
          'AUTH_FORBIDDEN',
        );
      }
      const otherManager = actors.get(
        unit === 'website' ? 'linxi' : 'website',
      )!.manager;
      await h.call(
        otherManager,
        'DELETE',
        `${prefix}/${own.id}`,
        { version: own.version },
        404,
        'INQUIRY_NOT_FOUND',
      );
      const operated = await h.actor(unit, 'COORDINATOR', 'operation');
      if (unit !== 'shengxu')
        await h.call(
          operated,
          'DELETE',
          `${prefix}/${own.id}`,
          { version: 1 },
          403,
          'AUTH_FORBIDDEN',
        );
      // Transfer revokes the old owner and grants the new reception coordinator deletion.
      const transferBody = {
        version: own.version,
        ownerId: b.id,
        reason: 'Delete ownership check',
      };
      await h.call(
        manager,
        'POST',
        `${prefix}/${own.id}/transfer`,
        transferBody,
        201,
      );
      const received = await h.call<Inquiry>(b, 'GET', `${prefix}/${own.id}`);
      assert.equal(received.canDelete, true);
      await h.call(
        a,
        'DELETE',
        `${prefix}/${own.id}`,
        { version: received.version },
        404,
        'INQUIRY_NOT_FOUND',
      );
      await h.call(
        b,
        'DELETE',
        `${prefix}/${own.id}`,
        { version: received.version },
        204,
      );
      await h.call(
        root,
        'GET',
        `${prefix}/${own.id}`,
        undefined,
        404,
        'INQUIRY_NOT_FOUND',
      );
      await h.call(
        a,
        'DELETE',
        `${prefix}/${own.id}`,
        { version: received.version },
        404,
        'INQUIRY_NOT_FOUND',
      );
      const assigned = await create(unit, root, a);
      assert.equal(
        (await h.call<Inquiry>(a, 'GET', `${prefix}/${assigned.id}`)).canDelete,
        true,
      );
      await h.call(
        root,
        'DELETE',
        `${prefix}/${assigned.id}`,
        { version: assigned.version },
        204,
      );
      if (unit !== 'shengxu') {
        const reception = await h.actor(unit, 'COORDINATOR', 'reception');
        const receivedOwn = await create(unit, reception);
        assert.equal(receivedOwn.canDelete, true);
        await h.call(
          reception,
          'DELETE',
          `${prefix}/${receivedOwn.id}`,
          { version: receivedOwn.version },
          204,
        );
      }
      // Concurrent retries: exactly one deletion succeeds.
      const race = await create(unit, a);
      const outcomes = await Promise.allSettled(
        [0, 1].map(() =>
          h.call(
            a,
            'DELETE',
            `${prefix}/${race.id}`,
            { version: race.version },
            204,
          ),
        ),
      );
      assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
      assert.equal(
        (
          await h.db.query<{ version: number }[]>(
            `SELECT version FROM ${table} WHERE id=$1`,
            [race.id],
          )
        )[0].version,
        race.version + 1,
      );
      for (const status of ['lost', 'archived']) {
        const ended = await create(unit, a);
        await h.db.query(`UPDATE ${table} SET status=$2 WHERE id=$1`, [
          ended.id,
          status,
        ]);
        await h.call(
          manager,
          'DELETE',
          `${prefix}/${ended.id}`,
          { version: ended.version },
          204,
        );
      }
      // Retain the frozen plan and cancelled tour while denying all old parent links.
      const linked = await create(unit, a);
      const { planId, quoteId } = await frozen(unit, linked, a);
      const tour = await h.call<RecordRef>(
        root,
        'POST',
        '/tours',
        {
          sourceModule,
          inquiryId: linked.id,
          quoteId,
          operatorId: a.id,
          adults: 2,
          children: 0,
          leaders: 0,
          shopping: false,
          guideServices: [],
          scheduleMode: 'flight',
          pickupFlightId: flights[0],
          dropFlightId: flights[1],
        },
        201,
      );
      assert.equal(
        (await h.call<Inquiry>(manager, 'GET', `${prefix}/${linked.id}`))
          .canDelete,
        false,
      );
      await h.call(
        manager,
        'DELETE',
        `${prefix}/${linked.id}`,
        { version: linked.version },
        409,
        'INQUIRY_READ_ONLY',
      );
      await h.call(
        root,
        'POST',
        `/tours/${tour.id}/cancel`,
        { version: tour.version, reason: 'Delete fixture' },
        201,
      );
      const snapshotTable =
        unit === 'shengxu' ? 'itinerary_quotes' : 'website_quotations';
      const snapshot = await h.db.query<Record<string, unknown>[]>(
        `SELECT * FROM ${snapshotTable} WHERE id=$1`,
        [quoteId],
      );
      await h.call(
        manager,
        'DELETE',
        `${prefix}/${linked.id}`,
        { version: linked.version },
        204,
      );
      assert.deepEqual(
        await h.db.query(`SELECT * FROM ${snapshotTable} WHERE id=$1`, [
          quoteId,
        ]),
        snapshot,
      );
      assert.equal(
        (
          await h.db.query<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM ${table} WHERE id=$1 AND deleted_at IS NOT NULL`,
            [linked.id],
          )
        )[0].n,
        1,
      );
      await h.call(
        root,
        'GET',
        `${prefix}/${linked.id}/itineraries`,
        undefined,
        404,
        'INQUIRY_NOT_FOUND',
      );
      await h.call(
        root,
        'GET',
        `${planPrefix}/${planId}`,
        undefined,
        404,
        'INQUIRY_NOT_FOUND',
      );
      await h.call(
        root,
        'GET',
        `${planPrefix}/${planId}/${unit === 'shengxu' ? 'pdf-data' : 'quotation'}`,
        undefined,
        404,
        'INQUIRY_NOT_FOUND',
      );
      await h.call(
        root,
        'GET',
        `${logPrefix}?inquiryId=${linked.id}`,
        undefined,
        404,
        'INQUIRY_NOT_FOUND',
      );
      const page = await h.call<{ list: Inquiry[] }>(
        root,
        'GET',
        `${prefix}?keyword=${linked.code}`,
      );
      assert.equal(page.list.length, 0);
      const sources = await h.call<{ inquiryId: string }[]>(
        root,
        'GET',
        `/tours/sources?sourceModule=${sourceModule}`,
      );
      assert(!sources.some((r) => r.inquiryId === linked.id));
      await h.call(
        root,
        'POST',
        '/tours',
        {
          sourceModule,
          inquiryId: linked.id,
          quoteId,
          operatorId: a.id,
          adults: 2,
          children: 0,
          leaders: 0,
          shopping: false,
          guideServices: [],
          scheduleMode: 'flight',
          pickupFlightId: flights[0],
          dropFlightId: flights[1],
        },
        404,
        'INQUIRY_NOT_FOUND',
      );
      await h.call(root, 'GET', `/tours/${tour.id}`);
      console.log(
        `PASS ${unit}: owner/transfer/manager/cross-business/duties/version/concurrency/ended/active-tour/read isolation/retained snapshots`,
      );
    }
    console.log(`PASS inquiry deletion: ${h.requests} real HTTP requests`);
  } finally {
    await h.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
