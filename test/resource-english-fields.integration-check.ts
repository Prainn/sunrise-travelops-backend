/** Connects only to disposable PostgreSQL on localhost:55439; never loads env files. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AttractionEntity } from '../src/resources/attractions/attraction.entity';
import { AttractionsService } from '../src/resources/attractions/attractions.service';
import {
  CreateAttractionDto,
  UpdateAttractionDto,
} from '../src/resources/attractions/dto/attraction.dto';
import { RestaurantEntity } from '../src/resources/restaurants/restaurant.entity';
import { RestaurantsService } from '../src/resources/restaurants/restaurants.service';
import {
  CreateRestaurantDto,
  UpdateRestaurantDto,
} from '../src/resources/restaurants/dto/restaurant.dto';
import { HotelEntity } from '../src/resources/hotels/hotel.entity';
import { HotelsService } from '../src/resources/hotels/hotels.service';
import {
  CreateHotelDto,
  UpdateHotelDto,
} from '../src/resources/hotels/dto/hotel.dto';
import { CityEntity } from '../src/resources/cities/city.entity';
import { ResourceValidationService } from '../src/resources/common/resource-validation.service';
import { BusinessDictionaryTypeEntity } from '../src/system/business-dictionaries/business-dictionary-type.entity';
import { BusinessDictionaryItemEntity } from '../src/system/business-dictionaries/business-dictionary-item.entity';
import { SelectionService } from '../src/resources/selections/selection.service';

const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55439,
  username: 'postgres',
  password: 'isolated-test-only',
};
const admin = new DataSource({ ...connection, database: 'postgres' });
const databases = [
  `resource_english_empty_${Date.now()}`,
  `resource_english_old_${Date.now()}`,
];
const migrationName = 'AddResourceEnglishFields1792108800000';
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const actorId = randomUUID();
const source = (database: string) =>
  new DataSource({
    ...connection,
    database,
    synchronize: false,
    migrations: ['src/migrations/*.ts'],
    entities: ['src/**/*.entity.ts'],
  });
const dto = <T>(metatype: new () => T, value: object): Promise<T> =>
  pipe.transform(value, { type: 'body', metatype }) as Promise<T>;

async function run() {
  await admin.initialize();
  let db: DataSource | undefined;
  try {
    for (const database of databases)
      await admin.query(`CREATE DATABASE "${database}"`);
    db = await source(databases[0]).initialize();
    assert.equal((await db.runMigrations()).length, db.migrations.length);
    assert.equal((await db.runMigrations()).length, 0);
    await db.destroy();

    db = await source(databases[1]).initialize();
    const all = [...db.migrations];
    db.migrations.splice(
      0,
      db.migrations.length,
      ...all.filter((migration) => migration.name !== migrationName),
    );
    await db.runMigrations();
    for (const [table, extra] of [
      [
        'resource_hotels',
        "rating,individual_price,unit) VALUES ('HTL-900','历史酒店',5,123.45,'roomNight')",
      ],
      [
        'resource_restaurants',
        "description,price,unit) VALUES ('RES-900','历史餐厅','原描述',NULL,'personMeal')",
      ],
      [
        'resource_attractions',
        "description,price,unit) VALUES ('ATT-900','历史景点','原描述',0,'personVisit')",
      ],
    ])
      await db.query(`INSERT INTO ${table} (code,name,${extra}`);
    const tables = [
      'resource_hotels',
      'resource_restaurants',
      'resource_attractions',
    ];
    const before = await Promise.all(
      tables.map((table) => db!.query(`SELECT * FROM ${table}`)),
    );
    db.migrations.splice(0, db.migrations.length, ...all);
    assert.deepEqual(
      (await db.runMigrations()).map((migration) => migration.name),
      [migrationName],
    );
    assert.equal((await db.runMigrations()).length, 0);
    for (const [index, table] of tables.entries()) {
      const rows: Record<string, unknown>[] = await db.query(
        `SELECT * FROM ${table}`,
      );
      assert.equal(rows[0].english_name, '');
      if (table !== 'resource_hotels')
        assert.equal(rows[0].english_description, '');
      delete rows[0].english_name;
      delete rows[0].english_description;
      assert.deepEqual(rows, before[index]);
    }
    const validation = new ResourceValidationService(
      db.getRepository(BusinessDictionaryTypeEntity),
      db.getRepository(BusinessDictionaryItemEntity),
      db.getRepository(CityEntity),
    );
    await db.query(
      "INSERT INTO resource_cities (code,name,province) VALUES ('CITY-900','英文信息测试城市','云南')",
    );
    const hotels = new HotelsService(
      db.getRepository(HotelEntity),
      validation,
      db,
    );
    const restaurants = new RestaurantsService(
      db.getRepository(RestaurantEntity),
      validation,
      db,
    );
    const attractions = new AttractionsService(
      db.getRepository(AttractionEntity),
      validation,
      db,
    );
    const selections = new SelectionService(db);
    const cases = [
      {
        table: 'resource_hotels',
        description: false,
        base: {
          name: '酒店',
          city: '英文信息测试城市',
          province: '云南',
          rating: 5,
          facilities: '',
          breakfast: '',
          address: '',
          phone: '',
          nearby: '',
          individualPrice: '123.45',
          unit: 'roomNight',
          status: 'enabled',
        },
        create: async (input: object) =>
          hotels.create(await dto(CreateHotelDto, input), actorId),
        update: async (id: string, input: object) =>
          hotels.update(id, await dto(UpdateHotelDto, input), actorId),
        get: (id: string) => hotels.get(id),
        list: () => hotels.list({ page: 1, pageSize: 50 }),
      },
      {
        table: 'resource_restaurants',
        description: true,
        base: {
          name: '餐厅',
          city: '英文信息测试城市',
          description: '原描述',
          price: '50.00',
          unit: 'personMeal',
          status: 'enabled',
        },
        create: async (input: object) =>
          restaurants.create(await dto(CreateRestaurantDto, input), actorId),
        update: async (id: string, input: object) =>
          restaurants.update(
            id,
            await dto(UpdateRestaurantDto, input),
            actorId,
          ),
        get: (id: string) => restaurants.get(id),
        list: () => restaurants.list({ page: 1, pageSize: 50 }),
      },
      {
        table: 'resource_attractions',
        description: true,
        base: {
          name: '景点',
          area: '英文信息测试城市',
          description: '原描述',
          price: '0.00',
          unit: 'personVisit',
          status: 'enabled',
        },
        create: async (input: object) =>
          attractions.create(await dto(CreateAttractionDto, input), actorId),
        update: async (id: string, input: object) =>
          attractions.update(
            id,
            await dto(UpdateAttractionDto, input),
            actorId,
          ),
        get: (id: string) => attractions.get(id),
        list: () => attractions.list({ page: 1, pageSize: 50 }),
      },
    ];
    for (const item of cases) {
      const legacy = (await item.list()).list[0];
      assert.equal((await item.get(legacy.id)).englishName, '');
      for (const englishName of [undefined, null, '', '   ']) {
        const created = await item.create({
          ...item.base,
          englishName,
          ...(item.description ? { englishDescription: englishName } : {}),
        });
        assert.equal(created.englishName, '');
        if ('englishDescription' in created)
          assert.equal(created.englishDescription, '');
      }
      const created = await item.create({
        ...item.base,
        englishName: '  English name  ',
        ...(item.description
          ? { englishDescription: '  First line\nSecond line  ' }
          : {}),
      });
      const saved = await item.get(created.id);
      assert.equal(saved.englishName, 'English name');
      if ('englishDescription' in saved)
        assert.equal(saved.englishDescription, 'First line\nSecond line');
      if (item.description) {
        const detail = await selections.detail(
          item.table === 'resource_restaurants' ? 'restaurant' : 'attraction',
          created.id,
        );
        assert.equal(detail.englishName, 'English name');
        assert.equal(detail.englishDescription, 'First line\nSecond line');
      }
      const edited = await item.update(created.id, {
        ...item.base,
        version: saved.version,
        englishName: 'Changed',
        ...(item.description
          ? { englishDescription: 'Changed description' }
          : {}),
      });
      assert.equal(
        (await item.list()).list.find((row) => row.id === created.id)
          ?.englishName,
        'Changed',
      );
      const cleared = await item.update(created.id, {
        ...item.base,
        version: edited.version,
        englishName: '',
        ...(item.description ? { englishDescription: '' } : {}),
      });
      assert.equal((await item.get(created.id)).englishName, '');
      if ('englishDescription' in cleared)
        assert.equal(cleared.englishDescription, '');
      await assert.rejects(item.create({ ...item.base, englishName: 42 }));
      await assert.rejects(
        item.create({ ...item.base, englishName: 'x'.repeat(151) }),
      );
      if (item.description)
        await assert.rejects(
          item.create({ ...item.base, englishDescription: 42 }),
        );
    }
    console.log(
      'PASS: full migration chain/repeat, legacy upgrade/data preservation, DTO validation, create/edit/clear/list/detail and selection detail.',
    );
  } finally {
    if (db?.isInitialized) await db.destroy();
    for (const database of databases)
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.destroy();
  }
}
void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
