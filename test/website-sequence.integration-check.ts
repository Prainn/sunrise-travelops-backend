/** This script only connects to the task's disposable localhost PostgreSQL container. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { AccountLinksService } from '../src/users/account-links.service';
import type { AuthenticatedUser } from '../src/auth/auth.types';
import { ValidationPipe } from '@nestjs/common';
import { WebsiteItineraryDto } from '../src/website/website.dto';
import { WebsiteSequenceAndDraft1793491200000 } from '../src/migrations/1793491200000-WebsiteSequenceAndDraft';
import {
  loadWebsiteDetails,
  saveWebsiteDetails,
} from '../src/website/website.persistence';
import type {
  WebsiteDay,
  WebsiteConfig,
  WebsiteReorderDraft,
} from '../src/website/website.types';

async function main() {
  const connection = {
    type: 'postgres' as const,
    host: '127.0.0.1',
    port: 55439,
    username: 'postgres',
    password: 'sequence-test',
    database: 'sequence_test',
  };
  const db = await new DataSource({
    ...connection,
    migrations: readdirSync(`${__dirname}/../src/migrations`)
      .filter(
        (name) =>
          name.endsWith('.ts') && !name.includes('WebsiteSequenceAndDraft'),
      )
      .map((name) => `${__dirname}/../src/migrations/${name}`),
    entities: [`${__dirname}/../src/**/*.entity.ts`],
    synchronize: false,
  }).initialize();
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await db.runMigrations({ transaction: 'all' });
    const q = db.createQueryRunner();
    await q.connect();
    try {
      const planId = randomUUID(),
        dayId = randomUUID(),
        itemId = randomUUID(),
        cityId = randomUUID();
      const columns = (await q.query(
        `SELECT column_name AS name,data_type AS type FROM information_schema.columns WHERE table_schema='public' AND table_name='website_itineraries' AND is_nullable='NO' AND column_default IS NULL`,
      )) as { name: string; type: string }[];
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
      await q.query('SET session_replication_role=replica');
      try {
        await q.query(
          `INSERT INTO website_itineraries(${columns.map((c) => c.name).join(',')}) VALUES(${values.map((_, i) => `$${i + 1}`).join(',')})`,
          values,
        );
      } finally {
        await q.query('SET session_replication_role=origin');
      }
      await q.query(
        `INSERT INTO website_days(id,itinerary_id,day_number,depart_city_id,end_city_id,guide_language,guide_scope) VALUES($1,$2,1,$3,$3,'English','Full day')`,
        [dayId, planId, cityId],
      );
      await q.query(
        `INSERT INTO website_items(id,day_id,position,attraction_id,name_zh,name_en,description_zh,description_en,appears,fee_state) VALUES($1,$2,0,null,'景点','Attraction','正文','Description',true,'ARRANGED')`,
        [itemId, dayId],
      );
      const frozen = {
        chinese: { text: '保留历史已安排' },
        guideScope: 'Full day',
        feeState: 'ARRANGED',
      };
      await q.query('SET session_replication_role=replica');
      try {
        await q.query(
          'INSERT INTO website_quotations(id,itinerary_id,code,snapshot,confirmed_by) VALUES($1,$2,$3,$4,$5)',
          [
            randomUUID(),
            planId,
            'frozen',
            JSON.stringify(frozen),
            randomUUID(),
          ],
        );
      } finally {
        await q.query('SET session_replication_role=origin');
      }
      await q.query(
        `UPDATE website_config_versions SET config=jsonb_set(jsonb_set(config,'{routes}',$1::jsonb),'{templates}',$2::jsonb) WHERE version=0`,
        [
          JSON.stringify([{ id: randomUUID(), feeState: 'ARRANGED' }]),
          JSON.stringify([
            {
              code: 'guide',
              zh: '{language}{service_scope}',
              en: '{language} {service_scope}',
            },
          ]),
        ],
      );
      await q.startTransaction();
      await new WebsiteSequenceAndDraft1793491200000().up(q);
      await q.commitTransaction();
      assert.equal(
        (
          (await q.query('SELECT fee_state FROM website_items WHERE id=$1', [
            itemId,
          ])) as { fee_state: string }[]
        )[0].fee_state,
        'INCLUDED',
      );
      assert.equal(
        (
          (await q.query(
            `SELECT 1 FROM information_schema.columns WHERE table_name='website_days' AND column_name='guide_scope'`,
          )) as unknown[]
        ).length,
        0,
      );
      const config = (
        (await q.query(
          'SELECT config FROM website_config_versions WHERE version=0',
        )) as { config: WebsiteConfig }[]
      )[0].config;
      assert.equal(config.routes[0].feeState, 'INCLUDED');
      assert.equal(config.templates[0].en, '{language}');
      assert.deepEqual(
        (
          (await q.query('SELECT snapshot FROM website_quotations')) as {
            snapshot: unknown;
          }[]
        )[0].snapshot,
        frozen,
      );
      const day: WebsiteDay = {
        id: dayId,
        dayNumber: 1,
        departCityId: '',
        endCityId: '',
        overnightCityId: null,
        guideLanguage: '',
        items: [],
        legs: [],
        hotels: [],
        meals: [],
        services: [],
        eventOrder: [],
      };
      const legId = randomUUID();
      day.items = [
        {
          id: itemId,
          attractionId: null,
          nameZh: '景点',
          nameEn: 'Sight',
          descriptionZh: '',
          descriptionEn: '',
          appears: true,
          feeState: 'INCLUDED',
        },
      ];
      day.legs = [
        {
          id: legId,
          routeId: null,
          fromCityId: cityId,
          toCityId: cityId,
          mode: 'private_vehicle',
          nameZh: '接送',
          nameEn: 'Transfer',
          feeState: 'UNKNOWN',
        },
      ];
      day.eventOrder = [legId, itemId];
      const copyId = randomUUID();
      const draft = {
        dayIds: [dayId],
        addedDayIds: [],
        deletedDays: [],
        placements: [{ dayId, itemIds: [itemId, copyId] }],
        copies: [
          {
            id: copyId,
            sourceId: itemId,
            parentId: itemId,
            dayId,
            placed: false,
          },
        ],
        overnight: [],
      };
      const input = {
        title: '',
        duration: 1,
        startDate: null,
        pax: null,
        arrivalTime: '',
        departureTime: '',
        configVersion: 0,
        days: [day],
        deletedDays: [],
        vehiclePrices: [],
        reorderDraft: draft,
      };
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });
      await pipe.transform(input, {
        type: 'body',
        metatype: WebsiteItineraryDto,
      });
      await assert.rejects(
        pipe.transform(
          { ...input, reorderDraft: { ...draft, unknown: true } },
          { type: 'body', metatype: WebsiteItineraryDto },
        ),
      );
      await db.transaction(async (manager) => {
        await saveWebsiteDetails(manager, planId, [day], []);
        await manager.query(
          'UPDATE website_itineraries SET reorder_draft=$2 WHERE id=$1',
          [planId, JSON.stringify(draft)],
        );
      });
      const loaded = await loadWebsiteDetails(db.manager, planId);
      assert.deepEqual(loaded.days, [day]);
      assert.deepEqual(
        (
          await db.query<{ reorder_draft: WebsiteReorderDraft }[]>(
            'SELECT reorder_draft FROM website_itineraries WHERE id=$1',
            [planId],
          )
        )[0].reorder_draft,
        draft,
      );
      await assert.rejects(
        q.query(
          `INSERT INTO website_items(id,day_id,position,name_zh,name_en,description_zh,description_en,appears,fee_state) VALUES($1,$2,0,'','','','',true,'ARRANGED')`,
          [randomUUID(), dayId],
        ),
      );
      console.log(
        'Old-data upgrade, fee constraint, removed field, incomplete draft DTO and persistence passed.',
      );
    } finally {
      await q.release();
    }
    // Exercise real candidate filtering with pagination, keyword intersection and linked-group visibility.
    const groupId = randomUUID();
    await db.query('INSERT INTO account_link_groups(id) VALUES($1)', [groupId]);
    const accounts: string[] = [];
    for (const [index, scope] of ['linxi', 'website', 'website'].entries()) {
      const id = randomUUID();
      accounts.push(id);
      await db.query(
        `INSERT INTO users(id,username,password_hash,nickname,english_name,status,account_link_id) VALUES($1,$2,'test-only',$3,'Test','enabled',$4)`,
        [
          id,
          `sequence-${index}`,
          `Candidate-${index}`,
          index === 2 ? groupId : null,
        ],
      );
      await db.query(
        'INSERT INTO user_identities(user_id,username,scope) VALUES($1,$2,$3)',
        [id, `sequence-${index}`, scope],
      );
    }
    const links = new AccountLinksService(db);
    const root = {
      scope: 'headquarters',
      roles: ['ROOT'],
    } as AuthenticatedUser;
    const filtered = await links.candidates(
      { page: 1, pageSize: 1, scope: 'website', keyword: 'Candidate' },
      root,
    );
    assert.equal(filtered.total, 1);
    assert.deepEqual(
      filtered.list.map((account) => account.userId),
      [accounts[1]],
    );
    const editing = await links.candidates(
      { page: 2, pageSize: 1, scope: 'website', keyword: 'Candidate', groupId },
      root,
    );
    assert.equal(editing.total, 2);
    assert.equal(editing.list.length, 1);
    assert.equal(
      (
        await links.candidates(
          { page: 1, pageSize: 10, scope: 'linxi', keyword: 'Candidate-1' },
          root,
        )
      ).total,
      0,
    );
    console.log(
      'Account candidate business/keyword intersection, pagination and group visibility passed.',
    );
    // Verify the complete chain from an empty database and migration-run idempotence.
    await db.query('CREATE DATABASE sequence_empty');
    const empty = await new DataSource({
      ...connection,
      database: 'sequence_empty',
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
      console.log('Empty-database migration chain and second run passed.');
    } finally {
      await empty.destroy();
    }
  } finally {
    await db.destroy();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
