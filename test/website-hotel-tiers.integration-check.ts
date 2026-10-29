/** Only the disposable website-cards PostgreSQL on localhost:55461; no environment files. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ValidationPipe } from '@nestjs/common';
import { WebsiteItineraryDto } from '../src/website/website.dto';
import {
  loadWebsiteDetails,
  saveWebsiteDetails,
} from '../src/website/website.persistence';
import type { WebsiteDay } from '../src/website/website.types';

async function main() {
  const db = await new DataSource({
    type: 'postgres',
    host: '127.0.0.1',
    port: 55461,
    username: 'postgres',
    password: 'website-cards-test',
    database: 'website_cards_test',
    migrations: ['src/migrations/*.ts'],
    entities: ['src/**/*.entity.ts'],
    synchronize: false,
  }).initialize();
  try {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    const all = [...db.migrations];
    db.migrations.splice(
      0,
      db.migrations.length,
      ...all.filter(
        (m) => !m.constructor.name.includes('ExpandWebsiteHotelTiers'),
      ),
    );
    await db.runMigrations({ transaction: 'all' });
    const planId = randomUUID(),
      dayId = randomUUID(),
      cityId = randomUUID();
    const columns = await db.query<Array<{ name: string; type: string }>>(
      `SELECT column_name AS name,data_type AS type FROM information_schema.columns WHERE table_schema='public' AND table_name='website_itineraries' AND is_nullable='NO' AND column_default IS NULL`,
    );
    if (!columns.some((c) => c.name === 'id'))
      columns.unshift({ name: 'id', type: 'uuid' });
    const values = columns.map(({ name, type }) =>
      name === 'id'
        ? planId
        : name === 'business_unit'
          ? 'website'
          : type === 'uuid'
            ? randomUUID()
            : ['integer', 'numeric'].includes(type)
              ? 1
              : 'fixture',
    );
    await db.query('SET session_replication_role=replica');
    try {
      await db.query(
        `INSERT INTO website_itineraries(${columns.map((c) => c.name).join(',')}) VALUES(${values.map((_, i) => `$${i + 1}`).join(',')})`,
        values,
      );
    } finally {
      await db.query('SET session_replication_role=origin');
    }
    const day: WebsiteDay = {
      id: dayId,
      dayNumber: 1,
      departCityId: cityId,
      endCityId: cityId,
      overnightCityId: cityId,
      items: [],
      legs: [],
      meals: [],
      services: [],
      guideLanguage: '',
      eventOrder: [],
      hotels: ['A', 'B'].map((tier) => ({
        id: randomUUID(),
        tier: tier as 'A' | 'B',
        cityId,
        configHotelId: null,
        resourceId: null,
        nameZh: `酒店${tier}`,
        nameEn: `Hotel ${tier}`,
        roomType: '',
        breakfastIncluded: true,
      })),
    };
    await db.transaction((manager) =>
      saveWebsiteDetails(manager, planId, [day], []),
    );
    const before = await loadWebsiteDetails(db.manager, planId);
    db.migrations.splice(0, db.migrations.length, ...all);
    assert.equal((await db.runMigrations({ transaction: 'all' })).length, 1);
    assert.deepEqual(await loadWebsiteDetails(db.manager, planId), before);
    assert.equal((await db.runMigrations()).length, 0);
    day.hotels.push(
      ...(['C', 'D'] as const).map((tier) => ({
        ...day.hotels[0],
        id: randomUUID(),
        tier,
        nameZh: `酒店${tier}`,
        nameEn: `Hotel ${tier}`,
      })),
    );
    const input = {
      title: '酒店四档',
      duration: 1,
      configVersion: 1,
      days: [day],
      vehiclePrices: [],
      reorderDraft: {
        dayIds: [dayId],
        addedDayIds: [],
        deletedDays: [],
        placements: [],
        copies: [],
        overnight: [],
        removedItemIds: [day.hotels[0].id],
        transportCopies: [
          {
            id: randomUUID(),
            routeId: null,
            fromCityId: cityId,
            toCityId: cityId,
            mode: 'hsr',
            nameZh: '',
            nameEn: '',
            feeState: 'INCLUDED',
          },
        ],
      },
    };
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const validated = (await pipe.transform(input, {
      type: 'body',
      metatype: WebsiteItineraryDto,
    })) as WebsiteItineraryDto;
    assert.deepEqual(
      validated.reorderDraft?.removedItemIds,
      input.reorderDraft.removedItemIds,
    );
    assert.equal(validated.reorderDraft?.transportCopies[0].mode, 'hsr');
    await db.query(
      'UPDATE website_itineraries SET reorder_draft=$1 WHERE id=$2',
      [JSON.stringify(validated.reorderDraft), planId],
    );
    const [stashed] = await db.query<Array<{ draft: unknown }>>(
      'SELECT reorder_draft AS draft FROM website_itineraries WHERE id=$1',
      [planId],
    );
    assert.deepEqual(
      stashed.draft,
      JSON.parse(JSON.stringify(validated.reorderDraft)),
    );
    await db.transaction((manager) =>
      saveWebsiteDetails(manager, planId, validated.days, []),
    );
    const loaded = await loadWebsiteDetails(db.manager, planId);
    assert.deepEqual(
      loaded.days[0].hotels.map((h) => h.tier),
      ['A', 'B', 'C', 'D'],
    );
    await assert.rejects(
      db.query(`UPDATE website_hotels SET tier='E' WHERE id=$1`, [
        day.hotels[3].id,
      ]),
      /website_hotels_tier_check/,
    );
    await assert.rejects(
      db.undoLastMigration({ transaction: 'all' }),
      /website_hotels_tier_check/,
    );
    assert.equal(
      (
        await db.query<Array<{ count: number }>>(
          `SELECT count(*)::int AS count FROM website_hotels WHERE tier IN ('C','D')`,
        )
      )[0].count,
      2,
    );
    await db.query('TRUNCATE website_hotels');
    await db.undoLastMigration({ transaction: 'all' });
    assert.equal((await db.runMigrations({ transaction: 'all' })).length, 1);
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    assert.equal(
      (await db.runMigrations({ transaction: 'all' })).length,
      all.length,
    );
    assert.equal((await db.runMigrations()).length, 0);
    console.log(
      'PASS: legacy A/B upgrade unchanged; four-tier DTO/persistence; invalid tier and unsafe rollback rejected; empty/full migration chain and repeat.',
    );
  } finally {
    await db.destroy();
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
