/** Disposable localhost database only; no .env or business database credentials. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { AddCityCoordinates1793750400000 } from '../src/migrations/1793750400000-AddCityCoordinates';
import { loadMapPlans } from '../src/tours/tour-map';
import { ToursService } from '../src/tours/tours.service';
import type { AuthenticatedUser } from '../src/auth/auth.types';

async function main() {
  const connection = {
    type: 'postgres' as const,
    host: '127.0.0.1',
    port: 55458,
    username: 'postgres',
    password: 'map-local-test',
  };
  const admin = await new DataSource({
    ...connection,
    database: 'postgres',
  }).initialize();
  const database = `travelops_map_${randomUUID().replaceAll('-', '')}`;
  const db = new DataSource({
    ...connection,
    database,
    entities: [resolve(__dirname, '../src/**/*.entity.ts')],
    migrations: [resolve(__dirname, '../src/migrations/*.ts')],
    synchronize: false,
  });
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    await db.initialize();
    const migrations = await db.runMigrations();
    assert.equal((await db.runMigrations()).length, 0);
    const q = db.createQueryRunner();
    // Exercise the additive migration against an old populated city table.
    await new AddCityCoordinates1793750400000().down(q);
    const [{ id }] = await db.query<{ id: string }[]>(
      `INSERT INTO resource_cities(code,name,province) VALUES('CITY-999999','地图测试城市','云南') RETURNING id`,
    );
    await new AddCityCoordinates1793750400000().up(q);
    const [old] = await db.query<{ longitude: null; latitude: null }[]>(
      'SELECT longitude,latitude FROM resource_cities WHERE id=$1',
      [id],
    );
    assert.deepEqual(old, { longitude: null, latitude: null });
    for (const sql of [
      'longitude=100',
      'longitude=181,latitude=25',
      "longitude=100,latitude='NaN'::float8",
    ])
      await assert.rejects(
        db.query(`UPDATE resource_cities SET ${sql} WHERE id=$1`, [id]),
      );
    await db.query(
      'UPDATE resource_cities SET longitude=100,latitude=25 WHERE id=$1',
      [id],
    );
    assert.deepEqual(await loadMapPlans(db.manager, [randomUUID()]), []);
    const user = {
      id: randomUUID(),
      scope: 'headquarters',
      roles: ['ROOT'],
      permissions: ['tour:list'],
    } as AuthenticatedUser;
    const result = await new ToursService(db).map({ date: '2026-10-26' }, user);
    assert.equal(result.totals.tours, 0);
    assert.equal(result.cities.find((c) => c.id === id)?.longitude, 100);
    await q.release();
    console.log(
      `PASS: ${migrations.length} migrations, repeat no-op, populated city upgrade, invalid coordinate constraints, both source SQL queries and empty map read`,
    );
  } finally {
    if (db.isInitialized) await db.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.destroy();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
