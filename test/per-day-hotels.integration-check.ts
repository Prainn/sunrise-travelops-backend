/** Disposable PostgreSQL 16 only: localhost:55447, no environment-file database configuration. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { UserEntity } from '../src/users/user.entity';
import {
  InquiryEntity,
  ItineraryEntity,
} from '../src/inquiries/inquiry.entity';
import {
  ITINERARY_TABLES,
  columnName,
  itineraryRows,
  loadItineraryData,
} from '../src/inquiries/structured-itinerary';
import { ItineraryValidation } from '../src/inquiries/itinerary-validation';
import { calculateItineraryQuote } from '../src/inquiries/quote-pricing';
import { priceDraft, priceResourceIds } from './fixtures/nullable-draft-prices';

const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55447,
  username: 'postgres',
  password: 'isolated-test-only',
};
const admin = new DataSource({ ...connection, database: 'postgres' });
const databases = [
  `per_day_hotels_empty_${Date.now()}`,
  `per_day_hotels_old_${Date.now()}`,
];
const migrationName = 'PerDayHotelsAndTotalOtherCosts1796256009000';
const source = (database: string) =>
  new DataSource({
    ...connection,
    database,
    synchronize: false,
    migrations: ['src/migrations/*.ts'],
    entities: ['src/**/*.entity.ts'],
  });

/** Pre-migration shape: one hotel per tier and city, per-person other costs. */
function legacyPlan() {
  const plan = priceDraft();
  const day = plan.dailyPlans[0];
  plan.paxTiers = [2, 4];
  plan.dailyPlans = [
    day,
    { ...structuredClone(day), id: 'day-2', dayNumber: 2, items: [] },
    {
      ...structuredClone(day),
      id: 'day-3',
      dayNumber: 3,
      overnightDestination: '',
      items: [],
    },
  ];
  plan.deletedDays = [
    {
      day: {
        ...structuredClone(day),
        id: 'day-deleted',
        dayNumber: 4,
        items: [],
      },
      originalDate: '2026-10-19',
    },
  ];
  const hotel = plan.hotelPlans[0].hotels[0];
  hotel.unitCost = 200;
  // A city without any overnight day had no cost and is dropped.
  plan.hotelPlans[0].hotels.push({ ...hotel, destination: '上海' });
  plan.quote.mealOtherCost = 10;
  plan.quote.attractionOtherCost = 5;
  plan.quote.mealOtherReason = '包餐';
  plan.quote.attractionOtherReason = '电瓶车';
  plan.quote.paxOtherCosts = [
    {
      pax: 2,
      guideOtherCost: 3,
      guideOtherReason: '门票',
      staffRoomOtherCost: null,
      staffRoomOtherReason: '',
    },
    {
      pax: 4,
      guideOtherCost: null,
      guideOtherReason: '',
      staffRoomOtherCost: 4,
      staffRoomOtherReason: '加床',
    },
  ];
  plan.quote.options[0].paxPrices = [
    { pax: 2, adultUnitPrice: null },
    { pax: 4, adultUnitPrice: null },
  ];
  plan.vehiclePlans[0].paxPrices = [2, 4].map((pax) => ({
    pax,
    totalPrice: 100,
    pricingMode: 'automatic' as const,
  }));
  plan.vehiclePlans[0].arrangements[0].paxPrices = [2, 4].map((pax) => ({
    pax,
    totalPrice: 100,
  }));
  return plan;
}

async function run() {
  await admin.initialize();
  let db: DataSource | undefined;
  try {
    for (const name of databases)
      await admin.query(`CREATE DATABASE "${name}"`);
    db = await source(databases[0]).initialize();
    assert.equal((await db.runMigrations()).length, db.migrations.length);
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
        username: 'per_day_hotels_root',
        passwordHash: 'isolated-test-only',
        nickname: '酒店测试',
        englishName: 'Hotel Test',
        isSuperuser: true,
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
        code: 'INQ-PER-DAY',
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
          plannedDays: 3,
          nextFollowUpAt: null,
          lostReason: '',
        },
      }),
    );
    const plan = legacyPlan();
    const row = await db.manager.save(
      ItineraryEntity,
      Object.assign(new ItineraryEntity(), {
        inquiryId: inquiry.id,
        code: 'ITI-PER-DAY',
        creator: user.username,
        status: 'draft',
        data: plan,
        title: plan.title,
        startDate: plan.startDate,
        paxTiers: plan.paxTiers,
        childRate: plan.childRate,
        childWithoutBedRate: plan.childWithoutBedRate,
      }),
    );
    // Write the old structured rows: itinerary_hotels has no day_id yet.
    const rows = itineraryRows(plan);
    for (const [table, columns] of Object.entries(ITINERARY_TABLES)) {
      const fields = Object.keys(columns).filter(
        (field) => !(table === 'itinerary_hotels' && field === 'dayId'),
      );
      for (const [position, item] of rows[
        table as keyof typeof rows
      ].entries()) {
        const values = fields.map(
          (field) =>
            item[field] ??
            (field === 'viaDestinations'
              ? []
              : field.endsWith('En')
                ? ''
                : null),
        );
        await db.query(
          `INSERT INTO ${table}(itinerary_id,position,${fields.map(columnName).join(',')}) VALUES ($1,$2,${values.map((_, i) => `$${i + 3}`).join(',')})`,
          [row.id, position, ...values],
        );
      }
    }

    db.migrations.splice(0, db.migrations.length, ...all);
    assert.deepEqual(
      (await db.runMigrations()).map((m) => m.name),
      [migrationName],
    );
    assert.equal((await db.runMigrations()).length, 0);

    assert.deepEqual(
      await db.query(
        'SELECT tier,day_id AS "dayId",destination,unit_cost::float AS "unitCost" FROM itinerary_hotels WHERE itinerary_id=$1 ORDER BY position',
        [row.id],
      ),
      [
        { tier: 4, dayId: 'day-1', destination: '杭州', unitCost: 200 },
        { tier: 4, dayId: 'day-2', destination: '杭州', unitCost: 200 },
      ],
    );
    assert.deepEqual(
      await db.query(
        'SELECT meal_other_cost::float AS meal, attraction_other_cost::float AS attraction FROM itinerary_quote_settings WHERE itinerary_id=$1',
        [row.id],
      ),
      [{ meal: 20, attraction: 10 }],
    );
    assert.deepEqual(
      await db.query(
        'SELECT pax,guide_other_cost::float AS guide,staff_room_other_cost::float AS staff FROM itinerary_pax_other_costs WHERE itinerary_id=$1 ORDER BY pax',
        [row.id],
      ),
      [
        { pax: 2, guide: 6, staff: null },
        { pax: 4, guide: null, staff: 16 },
      ],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO itinerary_hotels(itinerary_id,position,tier,day_id,destination,hotel_id,hotel_name,rating,breakfast,unit) VALUES($1,9,4,'day-1','杭州',$2,'重复',4,'','roomNight')",
        [row.id, priceResourceIds.hotel],
      ),
      /unique/i,
    );
    await assert.rejects(
      db.query(
        "INSERT INTO itinerary_hotels(itinerary_id,position,tier,day_id,destination,hotel_id,hotel_name,rating,breakfast,unit) VALUES($1,9,4,'no-day','杭州',$2,'孤立',4,'','roomNight')",
        [row.id, priceResourceIds.hotel],
      ),
      /foreign key/i,
    );

    const loaded = (await loadItineraryData(db.manager, row)).data;
    assert.deepEqual(
      loaded.hotelPlans[0].hotels.map((h) => h.dayId),
      ['day-1', 'day-2'],
    );
    // Room cost unchanged: two nights at 200 shared by two guests.
    const quote = calculateItineraryQuote(loaded);
    assert.equal(quote.options[0].hotelUnitCost, 200);
    assert.deepEqual(
      quote.options[0].paxPrices.map((p) => ({
        pax: p.pax,
        mealCost: p.mealCost,
        attractionCost: p.attractionCost,
        guide: p.guideServiceUnitCost,
        staff: p.staffRoomUnitCost,
      })),
      [
        { pax: 2, mealCost: 43.33, attractionCost: 105, guide: 53, staff: 0 },
        { pax: 4, mealCost: 38.33, attractionCost: 102.5, guide: 25, staff: 4 },
      ],
    );
    // The upgraded itinerary saves again unchanged.
    await new ItineraryValidation().normalize(db.manager, loaded, loaded);
    console.log('per-day hotels migration check passed');
  } finally {
    await db?.destroy();
    for (const name of databases)
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.destroy();
  }
}
void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
