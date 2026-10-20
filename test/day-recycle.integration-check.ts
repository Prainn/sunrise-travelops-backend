/** Run only against the disposable database/container created for this task. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { ItineraryInput } from '../src/inquiries/inquiry.dto';
import { ItineraryEntity } from '../src/inquiries/inquiry.entity';
import {
  loadItineraryData,
  saveItineraryData,
} from '../src/inquiries/structured-itinerary';
import {
  loadWebsiteDetails,
  saveWebsiteDetails,
} from '../src/website/website.persistence';
import { WebsiteDay } from '../src/website/website.types';
import { WebsiteItineraryDto } from '../src/website/website.dto';
import { ValidationPipe } from '@nestjs/common';
import { AddItineraryDayRecycle1792627200000 } from '../src/migrations/1792627200000-AddItineraryDayRecycle';

async function main() {
  const port = Number(process.env.DAY_RECYCLE_TEST_PORT);
  assert.ok(port > 0 && port !== 5432, 'Provide the disposable container port');
  const connection = {
    type: 'postgres' as const,
    host: '127.0.0.1',
    port,
    username: 'postgres',
    password: 'day-recycle-test',
    database: 'day_recycle_test',
  };
  const db = await new DataSource({
    ...connection,
    migrations: readdirSync(`${__dirname}/../src/migrations`)
      .filter(
        (name) =>
          name.endsWith('.ts') && !name.includes('AddItineraryDayRecycle'),
      )
      .map((name) => `${__dirname}/../src/migrations/${name}`),
    synchronize: false,
  }).initialize();
  try {
    await db.query('DROP DATABASE IF EXISTS day_recycle_empty');
    await db.query('CREATE DATABASE day_recycle_empty');
    const empty = await new DataSource({
      ...connection,
      database: 'day_recycle_empty',
      migrations: [`${__dirname}/../src/migrations/*.ts`],
      synchronize: false,
    }).initialize();
    try {
      await empty.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      await empty.runMigrations({ transaction: 'all' });
      assert.equal(
        (await empty.runMigrations({ transaction: 'all' })).length,
        0,
      );
    } finally {
      await empty.destroy();
      await db.query('DROP DATABASE day_recycle_empty');
    }
    await db.query('DROP SCHEMA public CASCADE');
    await db.query('CREATE SCHEMA public');
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await db.runMigrations({ transaction: 'all' });
    await db.runMigrations({ transaction: 'all' });
    const q = db.createQueryRunner();
    await q.connect();
    const normalId = randomUUID();
    const websiteId = randomUUID();
    // Only parent fixture inserts bypass foreign-key checks in this throwaway database.
    // The migration, detail inserts, unique indexes and reads run with ordinary constraints.
    async function parent(table: string, id: string) {
      const columns = (await q.query(
        `SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND is_nullable='NO' AND column_default IS NULL`,
        [table],
      )) as { name: string; type: string }[];
      if (!columns.some((column) => column.name === 'id'))
        columns.unshift({ name: 'id', type: 'uuid' });
      const values = columns.map(({ name, type }) => {
        if (name === 'id') return id;
        if (name === 'status') return 'draft';
        if (name === 'business_unit') return 'website';
        if (name === 'start_date') return '2026-10-20';
        if (type === 'uuid') return randomUUID();
        if (type === 'ARRAY') return [10];
        if (['integer', 'double precision', 'numeric'].includes(type)) return 1;
        return 'fixture';
      });
      await q.query('SET session_replication_role = replica');
      try {
        await q.query(
          `INSERT INTO ${table}(${columns.map((column) => column.name).join(',')}) VALUES(${values.map((_, index) => `$${index + 1}`).join(',')})`,
          values,
        );
      } finally {
        await q.query('SET session_replication_role = origin');
      }
    }
    await parent('itineraries', normalId);
    await parent('website_itineraries', websiteId);
    await q.query(
      `INSERT INTO itinerary_days(itinerary_id,position,id,day_number,date,departure,destination,overnight_destination,breakfast,lunch,dinner,transport,description) VALUES($1,0,'old-day',1,'2026-10-20','A','B','B',false,false,false,'','old content')`,
      [normalId],
    );
    await q.query(
      `INSERT INTO website_days(id,itinerary_id,day_number,depart_city_id,end_city_id,overnight_city_id,guide_language,guide_scope) VALUES($1,$2,1,$3,$3,null,'English','whole day')`,
      [randomUUID(), websiteId, randomUUID()],
    );
    const migration = new AddItineraryDayRecycle1792627200000();
    await migration.up(q);
    for (const table of ['itinerary_days', 'website_days']) {
      const rows = (await q.query(
        `SELECT is_deleted,original_date FROM ${table}`,
      )) as { is_deleted: boolean; original_date: null }[];
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], { is_deleted: false, original_date: null });
    }
    const data = plainToInstance(ItineraryInput, {
      title: 'roundtrip',
      startDate: '2026-10-20',
      paxTiers: [10],
      childRate: 90,
      childWithoutBedRate: 90,
      destinations: ['B'],
      hotelPlans: [],
      vehiclePlans: [],
      guidePlans: [],
      quote: {
        staffRoomCosts: [],
        paxOtherCosts: [],
        options: [],
        transportFees: [],
        mealOtherReason: '',
        attractionOtherReason: '',
        customerNotes: '',
        holidayRestrictions: '',
        hotelReplacementTerms: '',
      },
      dailyPlans: [
        {
          id: 'active',
          dayNumber: 1,
          date: '2026-10-20',
          departure: 'A',
          destination: 'B',
          overnightDestination: '',
          meals: { breakfast: false, lunch: false, dinner: false },
          transport: '',
          description: 'active',
          items: [],
        },
      ],
      deletedDays: [
        {
          originalDate: '2026-10-20',
          day: {
            id: 'recycled',
            dayNumber: 1,
            date: '2026-10-20',
            departure: 'A',
            destination: 'B',
            overnightDestination: 'B',
            meals: { breakfast: false, lunch: false, dinner: false },
            transport: '',
            description: 'deleted content',
            items: [
              {
                id: 'ticket',
                type: 'attraction',
                resourceId: randomUUID(),
                resourceName: 'snapshot ticket',
                priceName: '',
                quantity: 1,
                dinerCount: null,
                unit: 'personVisit',
                unitCost: 19.25,
                totalCost: 19.25,
                remark: '',
                mealSlot: null,
                referencePrice: 19.25,
                referenceBasis: 'resource_price',
                adjustmentReason: '',
              },
            ],
          },
        },
      ],
    });
    const row = Object.assign(new ItineraryEntity(), {
      id: normalId,
      title: data.title,
      startDate: data.startDate,
      paxTiers: data.paxTiers,
      childRate: data.childRate,
      childWithoutBedRate: data.childWithoutBedRate,
      data,
    });
    await saveItineraryData(q.manager, row);
    await loadItineraryData(q.manager, row);
    assert.equal(row.data.dailyPlans.length, 1);
    assert.equal(row.data.deletedDays?.[0].day.items[0].unitCost, 19.25);
    assert.equal(row.data.deletedDays?.[0].originalDate, '2026-10-20');
    await assert.rejects(migration.down(q), /Restore deleted itinerary days/);
    const city = randomUUID();
    const active: WebsiteDay = {
      id: randomUUID(),
      dayNumber: 1,
      departCityId: city,
      endCityId: city,
      overnightCityId: null,
      guideLanguage: '',
      guideScope: '',
      items: [],
      legs: [],
      hotels: [],
      meals: [],
      services: [],
    };
    const recycled: WebsiteDay = {
      ...active,
      id: randomUUID(),
      guideLanguage: 'English',
      departCityId: '',
      endCityId: '',
      items: [
        {
          id: randomUUID(),
          attractionId: null,
          nameZh: '景点快照',
          nameEn: 'Snapshot attraction',
          descriptionZh: '描述',
          descriptionEn: 'Description',
          appears: true,
          feeState: 'INCLUDED',
        },
      ],
    };
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await pipe.transform(
      {
        title: 'empty recycled day',
        duration: 1,
        configVersion: 0,
        days: [active],
        deletedDays: [{ day: recycled, originalDate: null }],
      },
      { type: 'body', metatype: WebsiteItineraryDto },
    );
    await assert.rejects(
      pipe.transform(
        {
          title: 'invalid active day',
          duration: 1,
          configVersion: 0,
          days: [recycled],
        },
        { type: 'body', metatype: WebsiteItineraryDto },
      ),
    );
    await saveWebsiteDetails(
      q.manager,
      websiteId,
      [active],
      [],
      [{ day: recycled, originalDate: null }],
    );
    const loaded = await loadWebsiteDetails(q.manager, websiteId);
    assert.deepEqual(loaded.days, [active]);
    assert.deepEqual(loaded.deletedDays, [
      { day: recycled, originalDate: null },
    ]);
    const restored = loaded.deletedDays[0].day;
    restored.dayNumber = 1;
    restored.departCityId = city;
    restored.endCityId = city;
    active.dayNumber = 2;
    await saveWebsiteDetails(q.manager, websiteId, [restored, active], [], []);
    const restoredLoad = await loadWebsiteDetails(q.manager, websiteId);
    assert.equal(restoredLoad.deletedDays.length, 0);
    assert.equal(restoredLoad.days[0].items[0].id, recycled.items[0].id);
    row.data.dailyPlans = [row.data.deletedDays[0].day, row.data.dailyPlans[0]];
    row.data.dailyPlans[1].dayNumber = 2;
    row.data.deletedDays = [];
    await saveItineraryData(q.manager, row);
    await migration.down(q);
    await migration.up(q);
    await q.release();
    console.log(
      'PASS: previous-schema upgrade, populated-day preservation, normal/website recycle roundtrips, stable resources, restore, rollback guard and re-upgrade',
    );
  } finally {
    await db.destroy();
  }
}
void main().catch((cause: unknown) => {
  console.error(cause);
  process.exitCode = 1;
});
