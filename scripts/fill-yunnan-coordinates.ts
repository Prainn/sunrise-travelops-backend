/** Authorized development-only coordinate import. Sources live in the workspace data file. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import db from '../src/database/data-source';

interface Coordinate {
  devResourceCityId: string;
  code: string;
  name: string;
  longitude: number;
  latitude: number;
}
async function main() {
  assert(
    process.argv.includes('--apply'),
    'Pass --apply only for the authorized development import',
  );
  assert.equal(db.options.database, 'travelops_dev');
  assert(
    'host' in db.options && db.options.host === 'api-dev.sunrisevacation.cn',
    'Development host only',
  );
  const file = resolve(
    __dirname,
    '../../docs/maps/yunnan/city-coordinates.json',
  );
  const data = JSON.parse(readFileSync(file, 'utf8')) as {
    coordinateSystem: string;
    cities: Coordinate[];
  };
  assert.equal(data.coordinateSystem, 'WGS84');
  assert.equal(data.cities.length, 6);
  await db.initialize();
  try {
    assert.equal(
      (
        await db.query<{ name: string }[]>('SELECT current_database() AS name')
      )[0].name,
      'travelops_dev',
    );
    const done = await db.query<{ name: string }[]>(
      'SELECT name FROM migrations',
    );
    const pending = db.migrations.filter(
      (m) => !done.some((d) => d.name === (m.name ?? m.constructor.name)),
    );
    assert(
      pending.length === 0 ||
        (pending.length === 1 &&
          (pending[0].name ?? pending[0].constructor.name) ===
            'AddCityCoordinates1793750400000'),
      'Unrelated pending migrations: stop',
    );
    const before = await db.query<Record<string, unknown>[]>(
      `SELECT id,code,name,province,status,version,to_jsonb(c)->'longitude' AS longitude,to_jsonb(c)->'latitude' AS latitude FROM resource_cities c WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY code`,
      [data.cities.map((c) => c.devResourceCityId)],
    );
    assert.equal(before.length, 6);
    for (const expected of data.cities) {
      const row = before.find((r) => r.id === expected.devResourceCityId)!;
      assert.equal(row.code, expected.code);
      assert.equal(row.name, expected.name);
      assert(['云南', '云南省'].includes(String(row.province)));
      assert(
        row.longitude == null ||
          (row.longitude === expected.longitude &&
            row.latitude === expected.latitude),
        'Existing coordinates differ; do not overwrite',
      );
    }
    const backup = resolve(
      __dirname,
      '../../docs/maps/yunnan/dev-coordinate-before.json',
    );
    // Keep the original preimage across safe reruns.
    try {
      writeFileSync(
        backup,
        JSON.stringify({ database: 'travelops_dev', rows: before }, null, 2) +
          '\n',
        { flag: 'wx' },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const applied = await db.runMigrations({ transaction: 'all' });
    const changed = await db.transaction(async (manager) => {
      const result: {
        name: string;
        longitude: number;
        latitude: number;
        version: number;
      }[] = [];
      for (const city of data.cities) {
        const rows = await manager.query<typeof result>(
          `WITH changed AS (UPDATE resource_cities SET longitude=$2,latitude=$3,version=version+1,updated_at=now()
          WHERE id=$1 AND code=$4 AND name=$5 AND province IN ('云南','云南省') AND deleted_at IS NULL AND longitude IS NULL AND latitude IS NULL
          RETURNING name,longitude,latitude,version) SELECT * FROM changed`,
          [
            city.devResourceCityId,
            city.longitude,
            city.latitude,
            city.code,
            city.name,
          ],
        );
        result.push(...rows);
      }
      const saved = await manager.query<
        { id: string; longitude: number; latitude: number }[]
      >(
        'SELECT id,longitude,latitude FROM resource_cities WHERE id=ANY($1::uuid[])',
        [data.cities.map((c) => c.devResourceCityId)],
      );
      for (const city of data.cities) {
        const row = saved.find((r) => r.id === city.devResourceCityId)!;
        assert.equal(row.longitude, city.longitude);
        assert.equal(row.latitude, city.latitude);
      }
      return result;
    });
    const receipt = {
      database: 'travelops_dev',
      executedAt: new Date().toISOString(),
      migrations: applied.map((m) => m.name),
      updated: changed.length,
      verified: 6,
      rows: changed,
    };
    writeFileSync(
      resolve(__dirname, '../../docs/maps/yunnan/dev-coordinate-result.json'),
      JSON.stringify(receipt, null, 2) + '\n',
    );
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    await db.destroy();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
