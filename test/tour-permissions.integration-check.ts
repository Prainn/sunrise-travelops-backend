/** Disposable PostgreSQL only; never reads environment files or business DB configuration. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddGuideRatingReadPermission1793232000000 } from '../src/migrations/1793232000000-AddGuideRatingReadPermission';
import { OperationLogEntity } from '../src/operation-logs/operation-log.entity';
import { OperationLogsService } from '../src/operation-logs/operation-logs.service';
import { OperationLogQueryDto } from '../src/operation-logs/operation-logs.controller';

const db = new DataSource({
  type: 'postgres',
  host: '127.0.0.1',
  port: 55442,
  username: 'postgres',
  password: 'isolated-tour-check',
  database: 'postgres',
  synchronize: false,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
});

async function run() {
  await db.initialize();
  try {
    const all = [...db.migrations];
    const migration = new AddGuideRatingReadPermission1793232000000();
    db.migrations.splice(
      0,
      db.migrations.length,
      ...all.filter(
        (item) => item.constructor.name !== migration.constructor.name,
      ),
    );
    const baseline = await db.runMigrations();
    const roles = [
      'ROOT',
      'ADMIN',
      'EXECUTIVE',
      'BUSINESS_MANAGER',
      'COORDINATOR',
      'RESOURCE_MANAGER',
    ];
    for (const code of roles) {
      await db.query(
        'INSERT INTO roles(code,name) VALUES ($1,$1) ON CONFLICT(code) DO NOTHING',
        [code],
      );
    }
    await db.query(
      "INSERT INTO permissions(code,name) VALUES ('test:preserved','Existing permission')",
    );
    await db.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='COORDINATOR' AND p.code='test:preserved'",
    );
    const grantsBefore = await db.query<Record<string, unknown>[]>(
      'SELECT * FROM role_permissions ORDER BY role_id,permission_id',
    );
    const menusBefore = await db.query<Record<string, unknown>[]>(
      'SELECT * FROM role_menu_configs ORDER BY role_id',
    );
    db.migrations.splice(0, db.migrations.length, ...all);
    assert.equal((await db.runMigrations()).length, 1);
    assert.equal((await db.runMigrations()).length, 0);
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      // Direct repeat also preserves the single permission and unique role links.
      await migration.up(runner);
      const links = await db.query<{ code: string }[]>(
        "SELECT r.code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE p.code='tour:rating:list' ORDER BY r.code",
      );
      assert.deepEqual(
        links.map((row: { code: string }) => row.code),
        ['ADMIN', 'BUSINESS_MANAGER', 'COORDINATOR', 'EXECUTIVE', 'ROOT'],
      );
      const [permission] = await db.query<{ count: number }[]>(
        "SELECT count(*)::int AS count FROM permissions WHERE code='tour:rating:list'",
      );
      assert.equal(permission.count, 1);
      assert.deepEqual(
        await db.query('SELECT * FROM role_menu_configs ORDER BY role_id'),
        menusBefore,
      );
      assert.deepEqual(
        await db.query(
          "SELECT rp.* FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE p.code <> 'tour:rating:list' ORDER BY rp.role_id,rp.permission_id",
        ),
        grantsBefore,
      );
      await migration.down(runner);
      assert.deepEqual(
        await db.query(
          'SELECT * FROM role_permissions ORDER BY role_id,permission_id',
        ),
        grantsBefore,
      );
      await migration.up(runner);
    } finally {
      await runner.release();
    }

    const logs = new OperationLogsService(db.getRepository(OperationLogEntity));
    await logs.append([
      ...(['headquarters', 'shengxu', 'linxi', 'website', null] as const).map(
        (scope) => ({
          scope,
          category: 'login',
          action: '登录',
          success: true,
          actorId: null,
          actorName: 'isolated fixture',
          detail: '{}',
          ip: null,
        }),
      ),
      {
        scope: 'linxi',
        category: 'user',
        action: '修改',
        success: true,
        actorId: null,
        actorName: 'isolated fixture',
        detail: '{}',
        ip: null,
      },
    ]);
    assert.equal((await logs.page(1, 20)).total, 6);
    for (const scope of ['headquarters', 'shengxu', 'website'] as const) {
      const result = await logs.page(1, 20, undefined, scope);
      assert.equal(result.total, 1);
      assert.equal(result.list[0].scope, scope);
    }
    const page = await logs.page(1, 1, undefined, 'linxi');
    assert.equal(page.total, 2);
    assert.equal(page.list.length, 1);
    assert.notEqual(
      (await logs.page(2, 1, undefined, 'linxi')).list[0].id,
      page.list[0].id,
    );
    const filtered = await logs.page(1, 20, 'user', 'linxi');
    assert.equal(filtered.total, 1);
    assert.equal(filtered.list[0].category, 'user');
    assert.equal((await logs.page(1, 20, 'user', 'shengxu')).total, 0);
    assert.equal((await logs.page(9, 20, undefined, 'linxi')).list.length, 0);
    for (const scope of ['headquarters', 'shengxu', 'linxi', 'website']) {
      assert.equal(
        (await validate(plainToInstance(OperationLogQueryDto, { scope })))
          .length,
        0,
      );
    }
    assert(
      (
        await validate(
          plainToInstance(OperationLogQueryDto, { scope: 'other' }),
        )
      ).some((error) => error.property === 'scope'),
    );
    console.log(
      `Passed: ${baseline.length} baseline migrations, permission upgrade/repeat/down/reapply, existing grants/menu preservation, operation-log scope/category/pagination and DTO validation.`,
    );
  } finally {
    await db.destroy();
  }
}
void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
