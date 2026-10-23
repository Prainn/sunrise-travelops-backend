/** Task-owned disposable localhost PostgreSQL only; no environment files. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { RetireUnusedPermissions1793577600000 } from '../src/migrations/1793577600000-RetireUnusedPermissions';

const codes = [
  'sys:role:list',
  'sys:role:create',
  'sys:role:update',
  'sys:role:delete',
  'sys:user:import',
  'sys:user:export',
];
async function main() {
  const db = await new DataSource({
    type: 'postgres',
    host: '127.0.0.1',
    port: 55443,
    username: 'postgres',
    password: 'isolated-permissions-check',
    database: 'postgres',
    entities: ['src/**/*.entity.ts'],
    migrations: ['src/migrations/*.ts'],
    synchronize: false,
  }).initialize();
  try {
    const migration = new RetireUnusedPermissions1793577600000();
    const all = [...db.migrations];
    db.migrations.splice(
      0,
      all.length,
      ...all.filter(
        (item) => item.constructor.name !== migration.constructor.name,
      ),
    );
    const baseline = await db.runMigrations({ transaction: 'all' });
    await db.query(
      "INSERT INTO roles(code,name) VALUES ('ROOT','ROOT'),('COORDINATOR','COORDINATOR') ON CONFLICT(code) DO NOTHING",
    );
    // Representative old data: custom names/links, one already absent retired code,
    // and an unrelated permission that must survive both up and down.
    await db.query('DELETE FROM permissions WHERE code=$1', [codes[5]]);
    await db.query('UPDATE permissions SET name=$1 WHERE code=$2', [
      '历史自定义名称',
      codes[0],
    ]);
    await db.query(
      "INSERT INTO permissions(code,name) VALUES ('test:preserved','保留')",
    );
    await db.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE p.code=ANY($1::text[]) OR p.code='test:preserved' ON CONFLICT DO NOTHING",
      [codes],
    );
    const before = await db.query<Record<string, unknown>[]>(
      'SELECT * FROM permissions ORDER BY code',
    );
    const links = await db.query<Record<string, unknown>[]>(
      'SELECT * FROM role_permissions ORDER BY role_id,permission_id',
    );
    const roles = await db.query<Record<string, unknown>[]>(
      'SELECT * FROM roles ORDER BY id',
    );
    const menus = await db.query<Record<string, unknown>[]>(
      'SELECT * FROM role_menu_configs ORDER BY role_id',
    );
    db.migrations.splice(0, db.migrations.length, ...all);
    assert.equal((await db.runMigrations({ transaction: 'all' })).length, 1);
    assert.equal((await db.runMigrations({ transaction: 'all' })).length, 0);
    const q = db.createQueryRunner();
    await q.connect();
    try {
      await migration.up(q);
      assert.deepEqual(
        await db.query(
          'SELECT code FROM permissions WHERE code=ANY($1::text[])',
          [codes],
        ),
        [],
      );
      assert.deepEqual(
        await db.query(
          "SELECT code FROM permissions WHERE code='test:preserved'",
        ),
        [{ code: 'test:preserved' }],
      );
      assert.deepEqual(
        await db.query('SELECT * FROM roles ORDER BY id'),
        roles,
      );
      assert.deepEqual(
        await db.query('SELECT * FROM role_menu_configs ORDER BY role_id'),
        menus,
      );
      await db.undoLastMigration({ transaction: 'all' });
      assert.deepEqual(
        await db.query('SELECT * FROM permissions ORDER BY code'),
        before,
      );
      assert.deepEqual(
        await db.query(
          'SELECT * FROM role_permissions ORDER BY role_id,permission_id',
        ),
        links,
      );
      await migration.down(q); // idempotent rollback without a backup table
      assert.equal((await db.runMigrations({ transaction: 'all' })).length, 1);
      assert.equal((await db.runMigrations({ transaction: 'all' })).length, 0);
      // Roll back, then demonstrate idempotent cleanup when all retired records are already absent.
      await db.undoLastMigration({ transaction: 'all' });
      await db.query('DELETE FROM permissions WHERE code=ANY($1::text[])', [
        codes,
      ]);
      await migration.up(q);
      await migration.up(q);
      await migration.down(q);
      assert.deepEqual(
        await db.query(
          'SELECT code FROM permissions WHERE code=ANY($1::text[])',
          [codes],
        ),
        [],
      );
    } finally {
      await q.release();
    }
    console.log(
      `Permission retirement migration passed: ${baseline.length} baseline migrations, upgrade/repeat/exact rollback/re-upgrade/already-absent cleanup; unrelated grants/roles/menus preserved.`,
    );
  } finally {
    await db.destroy();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
