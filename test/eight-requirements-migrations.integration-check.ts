/** Only disposable PostgreSQL 16 at localhost:55439; no environment files. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ItineraryEntity } from '../src/inquiries/inquiry.entity';
import {
  loadItineraryData,
  saveItineraryData,
} from '../src/inquiries/structured-itinerary';
const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55439,
  username: 'postgres',
  password: 'isolated-test-only',
};
const name = `eight_requirements_${Date.now()}`;
const admin = new DataSource({ ...connection, database: 'postgres' });
const db = new DataSource({
  ...connection,
  database: name,
  synchronize: false,
  migrations: ['src/migrations/*.ts'],
  entities: ['src/**/*.entity.ts'],
});
async function run() {
  await admin.initialize();
  await admin.query(`CREATE DATABASE "${name}"`);
  try {
    await db.initialize();
    const all = [...db.migrations];
    db.migrations.splice(
      0,
      db.migrations.length,
      ...all.filter(
        (m) =>
          Number((m.name ?? m.constructor.name).slice(-13)) < 1791878400000,
      ),
    );
    assert.equal((await db.runMigrations()).length, 56);
    const insert = async (table: string, values: Record<string, unknown>) => {
      const entries = Object.entries(values);
      const [row] = await db.query<Array<{ id: string }>>(
        `INSERT INTO ${table} (${entries.map(([key]) => key).join(',')}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
        entries.map(([, value]) => value),
      );
      return row.id;
    };
    const hotels: string[] = [];
    for (const [i, rating] of [
      'international_five_star',
      'ctrip_preferred',
    ].entries())
      hotels.push(
        await insert('resource_hotels', {
          code: `HTL-00${i + 1}`,
          name: `历史酒店${i}`,
          city: '昆明',
          rating,
          individual_price: '900.25',
          unit: 'roomNight',
        }),
      );
    const attraction = await insert('resource_attractions', {
      code: 'ATT-001',
      name: '石林',
      area: '昆明',
      category: 'scenic',
      description: '原景点说明',
      remark: '原景点备注',
      unit: 'person',
      is_standard_price: true,
    });
    const unpriced = await insert('resource_attractions', {
      code: 'ATT-002',
      name: '待补价景点',
      area: '昆明',
      category: 'scenic',
      unit: 'person',
    });
    const attractionPrices: string[] = [];
    for (const [i, fields] of [
      { item_name: '门票', rack_price: 120, settlement_price: 100 },
      { item_name: '电瓶车', rack_price: 40, settlement_price: 25 },
      {
        item_name: '免费讲解',
        rack_price: 0,
        settlement_price: 0,
        is_free: true,
      },
      {
        item_name: '已删除项目',
        rack_price: 20,
        settlement_price: 10,
        deleted_at: '2026-09-01',
      },
    ].entries())
      attractionPrices.push(
        await insert('resource_attraction_prices', {
          attraction_id: attraction,
          item_type: 'ticket',
          unit: 'person',
          audience: '成人',
          period_name: '旺季',
          price_note: '旧价格说明',
          created_at: `2026-08-0${i + 1}`,
          ...fields,
        }),
      );
    const restaurant = await insert('resource_restaurants', {
      code: 'RES-001',
      name: '测试餐厅',
      city: '昆明',
      unit: 'person',
      description: '原餐厅说明',
      remark: '原餐厅备注',
      is_standard_price: true,
    });
    const restaurantPrices: string[] = [];
    for (const [i, fields] of [
      { menu_name: '50元套餐', unit: 'person', price: 50 },
      { menu_name: '圆桌套餐', unit: 'table', price: 300, diner_count: 6 },
    ].entries())
      restaurantPrices.push(
        await insert('resource_restaurant_prices', {
          restaurant_id: restaurant,
          dish_details: '菜品明细',
          remark: '套餐备注',
          created_at: `2026-08-0${i + 1}`,
          ...fields,
        }),
      );
    const owner = await insert('users', {
      username: 'isolated-migration',
      nickname: 'Migration',
      password_hash: 'unused',
      english_name: 'Migration',
      tour_code: 'MIG',
    });
    const inquiry = await insert('inquiries', {
      code: 'INQ-MIG',
      owner_id: owner,
      owner: 'Migration',
      creator: 'Migration',
      business_unit: 'shengxu',
      agency_id: randomUUID(),
      contact_id: randomUUID(),
      agency_code: 'AGY-001',
      agency_name: '历史旅行社',
      contact_name: '历史联系人',
      email: '',
      phone: '',
      country_or_region: '',
      source_channel: 'Email',
      original_message: '',
      internal_remark: '',
      planned_days: 1,
      lost_reason: '',
    });
    const itinerary = await insert('itineraries', {
      inquiry_id: inquiry,
      code: 'ITN-MIG',
      creator: 'Migration',
      title: '旧草稿',
      start_date: '2026-10-14',
      pax_tiers: [10],
    });
    await insert('itinerary_days', {
      itinerary_id: itinerary,
      position: 0,
      id: 'day-1',
      day_number: 1,
      date: '2026-10-14',
      departure: '昆明',
      destination: '昆明',
      breakfast: true,
      lunch: true,
      dinner: true,
      transport: 'bus',
    });
    for (const [position, resource, price, type] of [
      [0, attraction, attractionPrices[1], 'attraction'],
      [1, restaurant, restaurantPrices[1], 'restaurant'],
      [2, attraction, attractionPrices[3], 'attraction'],
    ] as const)
      await insert('itinerary_items', {
        itinerary_id: itinerary,
        position,
        id: `item-${position}`,
        day_id: 'day-1',
        resource_id: resource,
        resource_price_id: price,
        type,
        resource_name: '选择时名称',
        price_name: '选择时价格项名称',
        quantity: 1,
        unit: type === 'restaurant' ? 'table' : 'person',
        diner_count: type === 'restaurant' ? 6 : null,
        unit_cost: '66.666',
        total_cost: '66.666',
        reference_price: '55.555',
        reference_basis: '原选择依据',
        adjustment_reason: '原原因',
        remark: '原备注',
      });
    for (const [position, tier, rating] of [
      [0, 'international_five_star', 'international_five_star'],
      [1, 'preferred_non_five_star', 'ctrip_preferred'],
    ] as const) {
      await db.query(
        'INSERT INTO itinerary_hotel_plans(itinerary_id,position,tier) VALUES($1,$2,$3)',
        [itinerary, position, tier],
      );
      await db.query(
        "INSERT INTO itinerary_hotels(itinerary_id,position,tier,destination,hotel_id,hotel_name,rating,breakfast,unit,unit_cost,reference_price) VALUES($1,$2,$3,'昆明',$4,'选择时酒店名称',$5,'included','roomNight',888.888,777.777)",
        [itinerary, position, tier, hotels[position], rating],
      );
      await db.query(
        "INSERT INTO itinerary_quote_options(itinerary_id,position,id,hotel_tier,vehicle_tier) VALUES($1,$2,$3,$4,'standard')",
        [itinerary, position, `option-${position}`, tier],
      );
    }
    await db.query(
      "INSERT INTO itinerary_quote_settings(itinerary_id,position,chinese_tip,english_tip,customer_notes,holiday_restrictions,hotel_replacement_terms,meal_other_reason,attraction_other_reason) VALUES($1,0,NULL,NULL,'','','','','')",
      [itinerary],
    );
    const quote = await insert('itinerary_quotes', {
      itinerary_id: itinerary,
      source_version: 1,
      created_by: owner,
      quote_code: 'Q-MIG',
      quote_version: 1,
      inquiry_id: inquiry,
      inquiry_version: 1,
      daily_resource_cost: '66.666',
      guide_cost: '123.456',
      snapshot: {
        itinerary: {
          tier: 'international_five_star',
          priceId: attractionPrices[1],
        },
        unitPrice: '66.666',
        referencePrice: '55.555',
      },
    });
    await db.query(
      "INSERT INTO quote_resource_lines(quote_id,position,item_key,type,name,resource_id,price_id,unit,unit_price,reference_price,tier) VALUES($1,0,'item-0','attraction','冻结时名称',$2,$3,'person',66.666,55.555,'international_five_star')",
      [quote, attraction, attractionPrices[1]],
    );
    const frozenBefore = await db.query<unknown[]>(
      'SELECT to_jsonb(q) AS row FROM itinerary_quotes q UNION ALL SELECT to_jsonb(q) FROM quote_resource_lines q',
    );
    await db.query(
      'UPDATE website_config_versions SET config=$1 WHERE version=0',
      [
        {
          version: 0,
          attractions: [{ id: randomUUID(), resourceId: attraction }],
          hotels: [{ id: randomUUID(), resourceId: hotels[0] }],
        },
      ],
    );
    const websiteBefore = await db.query<unknown[]>(
      'SELECT config FROM website_config_versions WHERE version=0',
    );
    db.migrations.splice(0, db.migrations.length, ...all);
    assert.equal((await db.runMigrations()).length, 2);
    assert.equal((await db.runMigrations()).length, 0);
    const attractions = await db.query<
      Array<{
        id: string;
        price: string | null;
        remark: string;
        deleted_at: Date | null;
      }>
    >(
      'SELECT id,price,remark,deleted_at FROM resource_attractions ORDER BY code',
    );
    assert.equal(attractions.length, 5);
    assert.equal(attractions.find((a) => a.id === attraction)?.price, '100.00');
    assert.equal(attractions.find((a) => a.id === unpriced)?.price, null);
    assert.equal(attractions.filter((a) => a.deleted_at).length, 1);
    assert.ok(attractions.find((a) => a.price === '0.00'));
    assert.ok(attractions[0].remark.includes('\n[原价格项]'));
    assert.ok(attractions[0].remark.includes('票面价：120.00'));
    assert.ok(attractions[0].remark.includes('人群：成人'));
    const restaurants = await db.query<
      Array<{
        id: string;
        price: string;
        unit: string;
        diner_count: number | null;
        description: string;
        remark: string;
        is_standard_price: boolean;
      }>
    >(
      'SELECT id,price,unit,diner_count,description,remark,is_standard_price FROM resource_restaurants ORDER BY code',
    );
    assert.equal(restaurants.length, 2);
    assert.ok(restaurants.every((r) => r.is_standard_price));
    assert.equal(restaurants[0].id, restaurant);
    assert.equal(restaurants[0].description, '原餐厅说明\n菜品明细');
    assert.equal(restaurants[0].remark, '原餐厅备注\n套餐备注');
    assert.equal(restaurants[1].unit, 'table');
    assert.equal(restaurants[1].diner_count, 6);
    const mapped = await db.query<
      Array<{ resource_id: string; unit_cost: string; reference_price: string }>
    >(
      'SELECT resource_id,unit_cost,reference_price FROM itinerary_items ORDER BY position',
    );
    assert.notEqual(mapped[0].resource_id, attraction);
    assert.equal(mapped[1].resource_id, restaurants[1].id);
    assert.ok(
      attractions.find((a) => a.id === mapped[2].resource_id)?.deleted_at,
    );
    assert.ok(
      mapped.every(
        (i) => i.unit_cost === '66.666' && i.reference_price === '55.555',
      ),
    );
    assert.deepEqual(
      await db.query('SELECT rating FROM resource_hotels ORDER BY code'),
      [{ rating: 5 }, { rating: 4 }],
    );
    assert.deepEqual(
      await db.query(
        'SELECT tier,unit_cost,reference_price FROM itinerary_hotels ORDER BY position',
      ),
      [
        { tier: 5, unit_cost: '888.888', reference_price: '777.777' },
        { tier: 4, unit_cost: '888.888', reference_price: '777.777' },
      ],
    );
    assert.deepEqual(
      await db.query(
        'SELECT hotel_tier FROM itinerary_quote_options ORDER BY position',
      ),
      [{ hotel_tier: 5 }, { hotel_tier: 4 }],
    );
    assert.deepEqual(
      await db.query(
        'SELECT config FROM website_config_versions WHERE version=0',
      ),
      websiteBefore,
    );
    assert.deepEqual(
      await db.query(
        'SELECT to_jsonb(q) AS row FROM itinerary_quotes q UNION ALL SELECT to_jsonb(q) FROM quote_resource_lines q',
      ),
      frozenBefore,
    );
    assert.deepEqual(
      await db.query(
        "SELECT to_regclass('resource_attraction_prices') AS a,to_regclass('resource_restaurant_prices') AS r",
      ),
      [{ a: null, r: null }],
    );
    const loaded = await loadItineraryData(
      db.manager,
      await db.manager.findOneByOrFail(ItineraryEntity, { id: itinerary }),
    );
    assert.equal(
      loaded.data.dailyPlans[0].items[0].resourceId,
      mapped[0].resource_id,
    );
    assert.equal(loaded.data.dailyPlans[0].items[0].unitCost, 66.666);
    assert.equal(loaded.data.dailyPlans[0].items[0].referencePrice, 55.555);
    await db.transaction((manager) => saveItineraryData(manager, loaded));
    assert.deepEqual(
      await db.query(
        'SELECT resource_id,unit_cost,reference_price FROM itinerary_items ORDER BY position',
      ),
      mapped,
    );
    await assert.rejects(
      db.query('UPDATE resource_hotels SET rating=2 WHERE id=$1', [hotels[0]]),
      /CHK_resource_hotels_rating/,
    );
    await assert.rejects(
      db.query('UPDATE resource_restaurants SET price=-1 WHERE id=$1', [
        restaurant,
      ]),
      /CHK_resource_restaurants_price/,
    );
    console.log(
      'PASS: legacy hotel tiers, flat resource codes/newlines, draft read/write and prices, deletion/unpriced/free, frozen snapshots and website references; 56 + 2 migrations, repeat 0',
    );
  } finally {
    if (db.isInitialized) await db.destroy();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.destroy();
  }
}
run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
