/** Disposable local database only; no business configuration is loaded. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { priceDraft } from './fixtures/nullable-draft-prices';
import { ItineraryEntity } from '../src/inquiries/inquiry.entity';
import {
  ITINERARY_TABLES,
  columnName,
  itineraryRows,
  loadItineraryData,
  saveItineraryData,
} from '../src/inquiries/structured-itinerary';
import { AddItineraryTableCount1796169600000 } from '../src/migrations/1796169600000-AddItineraryTableCount';

async function main() {
  const directory = join(__dirname, '../src/migrations');
  const db = new DataSource({
    type: 'postgres',
    host: '127.0.0.1',
    port: 55449,
    username: 'postgres',
    password: 'isolated-test-only',
    database: 'postgres',
    synchronize: false,
    entities: [join(__dirname, '../src/**/*.entity.ts')],
    migrations: readdirSync(directory)
      .filter((f) => f.endsWith('.ts') && !f.startsWith('1796169600000-'))
      .map((f) => join(directory, f)),
  });
  await db.initialize();
  try {
    const baseline = await db.runMigrations();
    assert.equal((await db.runMigrations()).length, 0);
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      // Clones preserve the real legacy columns/checks but intentionally omit foreign keys.
      await runner.query('CREATE SCHEMA meal_upgrade');
      for (const table of [
        ...Object.keys(ITINERARY_TABLES),
        'itineraries',
        'quote_resource_lines',
      ])
        await runner.query(
          `CREATE TABLE meal_upgrade.${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`,
        );
      await runner.query('SET search_path TO meal_upgrade, public');
      const data = priceDraft(650);
      data.hotelPlans = [];
      data.vehiclePlans = [];
      data.guidePlans = [];
      data.dailyPlans[0].items = [data.dailyPlans[0].items[0]];
      data.dailyPlans[0].items[0].totalCost = 216.67;
      const row = Object.assign(new ItineraryEntity(), {
        id: '196fda0c-4337-4d78-b948-71e27ad31bb0',
        title: data.title,
        startDate: data.startDate,
        paxTiers: data.paxTiers,
        childRate: data.childRate,
        data,
      });
      const rows = itineraryRows(data);
      for (const table of Object.keys(ITINERARY_TABLES) as Array<
        keyof typeof ITINERARY_TABLES
      >) {
        const fields = Object.keys(ITINERARY_TABLES[table]).filter(
          (f) => f !== 'tableCount',
        );
        for (const [position, record] of rows[table].entries()) {
          const values = fields.map(
            (f) =>
              record[f] ??
              (f === 'viaDestinations' ? [] : f.endsWith('En') ? '' : null),
          );
          await runner.query(
            `INSERT INTO ${table}(itinerary_id,position,${fields.map(columnName).join(',')}) VALUES ($1,$2,${values.map((_, i) => '$' + (i + 3)).join(',')})`,
            [row.id, position, ...values],
          );
        }
      }
      const migration = new AddItineraryTableCount1796169600000();
      await migration.up(runner);
      const legacy = (await loadItineraryData(runner.manager, row)).data
        .dailyPlans[0].items[0];
      assert.equal(legacy.tableCount, null);
      assert.equal(legacy.totalCost, 216.67);
      legacy.tableCount = 2;
      legacy.totalCost = 1300;
      await saveItineraryData(runner.manager, row);
      const saved = (await loadItineraryData(runner.manager, row)).data
        .dailyPlans[0].items[0];
      assert.equal(saved.tableCount, 2);
      assert.equal(saved.totalCost, 1300);
      for (const invalid of [0, -1, 10001])
        await assert.rejects(
          runner.query('UPDATE itinerary_items SET table_count=$1', [invalid]),
          /check constraint/,
        );
      await assert.rejects(
        runner.query("UPDATE itinerary_items SET unit='personMeal'"),
        /check constraint/,
      );
      await migration.down(runner);
      assert.equal(
        (
          await runner.manager.query<Array<{ total_cost: string }>>(
            'SELECT total_cost FROM itinerary_items',
          )
        )[0].total_cost,
        '1300',
      );
      await migration.up(runner);
      await runner.query('SET search_path TO public');
      await migration.up(runner);
      console.log(
        JSON.stringify({
          baselineMigrations: baseline.length,
          repeatMigrations: 0,
          legacyUnchanged: true,
          savedTableCount: 2,
          savedGroupTotal: 1300,
          constraints: true,
          downUp: true,
        }),
      );
    } finally {
      await runner.release();
    }
  } finally {
    await db.destroy();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
