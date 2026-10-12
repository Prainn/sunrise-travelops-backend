/** Only the disposable PostgreSQL 16 on localhost:55439; no environment files. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { loadWebsiteDetails } from '../src/website/website.persistence';

const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55439,
  username: 'postgres',
  password: 'isolated-test-only',
};
const name = `resource_unification_${Date.now()}`;
const admin = new DataSource({ ...connection, database: 'postgres' });
const db = new DataSource({
  ...connection,
  database: name,
  synchronize: false,
  migrations: ['src/migrations/*.ts'],
  entities: ['src/**/*.entity.ts'],
});
const migrationName = 'UnifyResourceLibrary1791619200000';

async function run() {
  await admin.initialize();
  await admin.query(`CREATE DATABASE "${name}"`);
  try {
    await db.initialize();
    const pending = db.migrations.find((m) => m.name === migrationName)!;
    db.migrations.splice(db.migrations.indexOf(pending), 1);
    assert.equal((await db.runMigrations()).length, 53);
    const insert = async (table: string, values: Record<string, unknown>) => {
      const entries = Object.entries(values);
      const [row] = await db.query<{ id: string }[]>(
        `INSERT INTO ${table} (${entries.map(([key]) => key).join(',')}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
        entries.map(([, value]) => value),
      );
      return row.id;
    };
    const retained = new Map<string, string>();
    const removed = new Map<string, string>();
    for (const [library, result, prefix] of [
      ['shengxu', retained, '9901'],
      ['shared', removed, '9902'],
    ] as const) {
      for (const [table, fields] of [
        ['resource_cities', { code: `CITY-${prefix}`, name: '升级测试城市' }],
        [
          'resource_agencies',
          { code: `AGY-${prefix}`, name: prefix, business_unit: 'linxi' },
        ],
        [
          'resource_hotels',
          {
            code: `HTL-${prefix}`,
            name: prefix,
            city: '升级测试城市',
            rating: 'international_five_star',
            individual_price: '123.45',
            unit: 'roomNight',
          },
        ],
        [
          'resource_restaurants',
          {
            code: `RES-${prefix}`,
            name: prefix,
            city: '升级测试城市',
            unit: 'person',
            is_standard_price: true,
          },
        ],
        [
          'resource_attractions',
          {
            code: `ATT-${prefix}`,
            name: prefix,
            area: '升级测试城市',
            category: 'scenic',
            unit: 'person',
            is_standard_price: true,
          },
        ],
        [
          'resource_transports',
          {
            code: `VEH-${prefix}`,
            name: prefix,
            seats: 7,
            service_level: 'standard',
            unit: 'vehicleDay',
          },
        ],
        [
          'resource_guides',
          {
            code: `GDE-${prefix}`,
            name: prefix,
            second_language: 'lo',
            shopping: true,
            daily_price: '234.56',
          },
        ],
        ['resource_guide_people', { code: `GPR-${prefix}`, name: prefix }],
        [
          'resource_flights',
          {
            departure_city: '升级测试城市',
            arrival_city: '目的地',
            flight_number: 'MU9876',
            departure_time: '08:00',
            arrival_time: '10:00',
          },
        ],
      ] as const)
        result.set(table, await insert(table, { ...fields, library }));
    }
    const agency = removed.get('resource_agencies')!;
    const child = await insert('resource_agencies', {
      code: 'AGY-9903',
      name: '删除父级-子级',
      library: 'shared',
      business_unit: 'website',
      parent_id: agency,
    });
    await insert('resource_agency_contacts', {
      agency_id: child,
      name: '测试联系人',
      name_key: '测试联系人',
    });
    await insert('resource_restaurant_prices', {
      restaurant_id: removed.get('resource_restaurants'),
      menu_name: '测试餐',
      unit: 'person',
      price: '12.34',
    });
    await insert('resource_attraction_prices', {
      attraction_id: removed.get('resource_attractions'),
      item_type: 'ticket',
      item_name: '测试票',
      rack_price: '45.67',
      settlement_price: '34.56',
      unit: 'person',
    });
    const before = new Map<string, unknown>();
    for (const [table, id] of retained)
      before.set(
        table,
        (
          await db.query<Record<string, unknown>[]>(
            `SELECT to_jsonb(t)-'library' AS row FROM ${table} t WHERE id=$1`,
            [id],
          )
        )[0].row,
      );
    const user = await insert('users', {
      username: 'migration-fixture',
      nickname: 'Migration',
      password_hash: 'unused',
      english_name: 'Migration',
      tour_code: 'MIG',
    });
    const city = randomUUID();
    const config = {
      cities: [
        {
          id: city,
          nameZh: '保留文案',
          resourceId: removed.get('resource_cities'),
        },
      ],
      attractions: [
        {
          id: randomUUID(),
          nameZh: '保留景点',
          resourceId: removed.get('resource_attractions'),
        },
      ],
      templates: [],
      routes: [],
      patterns: [],
      skeletons: [],
    };
    await db.query<Record<string, unknown>[]>(
      'UPDATE website_config_versions SET config=$1::jsonb WHERE version=0',
      [JSON.stringify(config)],
    );
    const wi = await insert('website_inquiries', {
      id: randomUUID(),
      code: 'WIQ-MIG',
      customer_name: 'Fixture',
      planned_days: 1,
      requirements: '',
      owner_id: user,
      owner: 'Migration',
      status: 'planning',
    });
    const plan = await insert('website_itineraries', {
      id: randomUUID(),
      inquiry_id: wi,
      code: 'WIT-MIG',
      title: '保留酒店安排',
      duration: 1,
      config_version: 0,
    });
    const day = await insert('website_days', {
      id: randomUUID(),
      itinerary_id: plan,
      day_number: 1,
      depart_city_id: city,
      end_city_id: city,
      overnight_city_id: city,
      guide_language: '',
      guide_scope: '',
    });
    const hotel = await insert('website_hotels', {
      id: randomUUID(),
      day_id: day,
      position: 0,
      tier: 'A',
      city_id: city,
      resource_id: removed.get('resource_hotels'),
      name_zh: '独立站自有酒店文案',
      name_en: 'Own Hotel',
      room_type: 'Twin',
      breakfast_included: true,
    });
    await insert('website_meals', {
      id: randomUUID(),
      day_id: day,
      position: 0,
      slot: 'lunch',
      resource_id: removed.get('resource_restaurants'),
      restaurant_zh: '自有餐厅文案',
      restaurant_en: 'Own Restaurant',
      fee_state: 'SELF_PAY',
    });
    const snapshot = {
      exact: '旧冻结不重算',
      price: '987.65',
      resourceId: removed.get('resource_hotels'),
    };
    await insert('website_quotations', {
      id: randomUUID(),
      itinerary_id: plan,
      code: 'WQT-MIG',
      snapshot: JSON.stringify(snapshot),
      confirmed_by: user,
    });
    const inquiry = await insert('inquiries', {
      code: 'IQ-MIG',
      owner_id: user,
      owner: 'Migration',
      creator: 'Migration',
      business_unit: 'linxi',
      agency_id: retained.get('resource_agencies'),
      contact_id: randomUUID(),
      agency_code: 'AGY-9901',
      agency_name: 'KEEP',
      contact_name: '',
      email: '',
      phone: '',
      country_or_region: '',
      source_channel: '',
      original_message: '',
      internal_remark: '',
      planned_days: 1,
      lost_reason: '',
    });
    const standard = await insert('itineraries', {
      inquiry_id: inquiry,
      code: 'IT-MIG',
      creator: 'Migration',
      title: 'Standard',
      start_date: '2026-10-12',
      pax_tiers: [2],
    });
    await db.query(
      `INSERT INTO itinerary_hotel_plans(itinerary_id,position,tier) VALUES($1,0,'A')`,
      [standard],
    );
    await db.query<Record<string, unknown>[]>(
      `INSERT INTO itinerary_hotels(itinerary_id,position,tier,destination,hotel_id,hotel_name,rating,breakfast,unit,unit_cost)
      VALUES($1,0,'A','升级测试城市',$2,'旧酒店','international_five_star','','roomNight',123.45)`,
      [standard, removed.get('resource_hotels')],
    );
    db.migrations.push(pending);
    await assert.rejects(
      db.runMigrations(),
      /standard itineraries.*itinerary_hotels/,
    );
    // A failed destructive migration must roll back schema AND prior JSON writes.
    assert.equal(
      (
        await db.query<Record<string, unknown>[]>(
          "SELECT column_name FROM information_schema.columns WHERE table_name='website_hotels' AND column_name='config_hotel_id'",
        )
      ).length,
      0,
    );
    assert.deepEqual(
      (
        await db.query<Record<string, unknown>[]>(
          'SELECT config FROM website_config_versions WHERE version=0',
        )
      )[0].config,
      config,
    );
    assert.equal(
      (
        await db.query<Record<string, unknown>[]>(
          'SELECT id FROM resource_hotels WHERE id=$1',
          [removed.get('resource_hotels')],
        )
      ).length,
      1,
    );
    await db.query<Record<string, unknown>[]>(
      'UPDATE itinerary_hotels SET hotel_id=$1 WHERE itinerary_id=$2',
      [retained.get('resource_hotels'), standard],
    );
    await db.query<Record<string, unknown>[]>(
      'UPDATE inquiries SET agency_id=$1 WHERE id=$2',
      [agency, inquiry],
    );
    await assert.rejects(
      db.runMigrations(),
      /inquiries using shared agencies: IQ-MIG/,
    );
    await db.query<Record<string, unknown>[]>(
      'UPDATE inquiries SET agency_id=$1 WHERE id=$2',
      [retained.get('resource_agencies'), inquiry],
    );
    const leave = await insert('resource_guide_leaves', {
      guide_person_id: removed.get('resource_guide_people'),
      start_date: '2026-10-12',
      end_date: '2026-10-12',
    });
    await assert.rejects(
      db.runMigrations(),
      /guide leaves using shared guides/,
    );
    await db.query<Record<string, unknown>[]>(
      'UPDATE resource_guide_leaves SET guide_person_id=$1 WHERE id=$2',
      [retained.get('resource_guide_people'), leave],
    );
    assert.equal((await db.runMigrations()).length, 1);
    assert.equal((await db.runMigrations()).length, 0);
    for (const [table, id] of retained) {
      assert.deepEqual(
        (
          await db.query<Record<string, unknown>[]>(
            `SELECT to_jsonb(t) AS row FROM ${table} t WHERE id=$1`,
            [id],
          )
        )[0].row,
        before.get(table),
      );
      assert.equal(
        (
          await db.query<Record<string, unknown>[]>(
            `SELECT id FROM ${table} WHERE id=$1`,
            [removed.get(table)],
          )
        ).length,
        0,
      );
    }
    for (const table of [
      'resource_agency_contacts',
      'resource_restaurant_prices',
      'resource_attraction_prices',
    ])
      assert.equal(
        (await db.query<Record<string, unknown>[]>(`SELECT id FROM ${table}`))
          .length,
        0,
      );
    assert.equal(
      (
        await db.query<Record<string, unknown>[]>(
          'SELECT id FROM resource_agencies WHERE id=$1',
          [child],
        )
      ).length,
      0,
    );
    const migrated = (
      await db.query<Record<string, unknown>[]>(
        'SELECT config FROM website_config_versions WHERE version=0',
      )
    )[0].config;
    assert.deepEqual(migrated, {
      ...config,
      hotels: [],
      cities: config.cities.map((c) => ({ ...c, resourceId: null })),
      attractions: config.attractions.map((a) => ({ ...a, resourceId: null })),
    });
    const details = await loadWebsiteDetails(db.manager, plan);
    assert.equal(details.days[0].hotels[0].id, hotel);
    assert.equal(details.days[0].hotels[0].resourceId, null);
    assert.equal(details.days[0].hotels[0].configHotelId, null);
    assert.equal(details.days[0].hotels[0].nameZh, '独立站自有酒店文案');
    assert.equal(details.days[0].meals[0].resourceId, null);
    assert.equal(details.days[0].meals[0].restaurantZh, '自有餐厅文案');
    assert.deepEqual(
      (
        await db.query<Record<string, unknown>[]>(
          'SELECT snapshot FROM website_quotations WHERE itinerary_id=$1',
          [plan],
        )
      )[0].snapshot,
      snapshot,
    );
    assert.equal(
      (
        await db.query<Record<string, unknown>[]>(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('library','resource_library')",
        )
      ).length,
      0,
    );
    assert.equal(
      (
        await db.query<Record<string, unknown>[]>(
          "SELECT to_regclass('resource_libraries') AS relation",
        )
      )[0].relation,
      null,
    );
    await assert.rejects(
      insert('resource_cities', { code: 'CITY-9904', name: '升级测试城市' }),
      /unique constraint/,
    );
    await assert.rejects(
      insert('resource_guides', {
        code: 'GDE-9904',
        name: 'Duplicate',
        second_language: 'lo',
        shopping: true,
        daily_price: '234.56',
      }),
      /unique constraint/,
    );
    await assert.rejects(
      insert('resource_restaurants', {
        code: 'RES-9904',
        name: 'Duplicate',
        city: '升级测试城市',
        unit: 'person',
        is_standard_price: true,
      }),
      /unique constraint/,
    );
    await assert.rejects(
      insert('resource_attractions', {
        code: 'ATT-9904',
        name: 'Duplicate',
        area: '升级测试城市',
        category: 'scenic',
        unit: 'person',
        is_standard_price: true,
      }),
      /unique constraint/,
    );
    await assert.rejects(
      insert('resource_flights', {
        departure_city: '升级测试城市',
        arrival_city: '目的地',
        flight_number: 'MU9876',
        departure_time: '08:00',
        arrival_time: '10:00',
      }),
      /unique constraint/,
    );
    console.log(
      'PASS: representative 53→54 upgrade; all 9 resource kinds retained/deleted; child cleanup; reference blockers and transaction rollback; website references/text/frozen snapshot; structured read; uniqueness; repeat migration.',
    );
  } finally {
    if (db.isInitialized) await db.destroy();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.destroy();
  }
}
run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
