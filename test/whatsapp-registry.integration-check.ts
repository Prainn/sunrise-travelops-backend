/** Targets only the disposable PostgreSQL container on localhost:55439. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { LynxVisit } from '../src/lynx/lynx-visit.entity';
import { WhatsappRegistryService } from '../src/lynx/whatsapp-registry.service';

const connection = {
  type: 'postgres' as const,
  host: '127.0.0.1',
  port: 55439,
  username: 'postgres',
  password: 'isolated-test-only',
};
const REGISTRY_MIGRATION = 1789521600000;

async function rowCount(source: DataSource): Promise<number> {
  const rows: unknown = await source.query(
    'SELECT count(*)::int AS n FROM lynx_visits',
  );
  assert(Array.isArray(rows));
  const first: unknown = rows[0];
  assert(first !== null && typeof first === 'object' && 'n' in first);
  return Number(first.n);
}

async function main(): Promise<void> {
  const admin = await new DataSource({
    ...connection,
    database: 'postgres',
  }).initialize();
  const name = `whatsapp_registry_check_${Date.now()}`;
  const emptyName = `${name}_empty`;
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.query(`CREATE DATABASE ${emptyName}`);
  const source = (database: string) =>
    new DataSource({
      ...connection,
      database,
      entities: [LynxVisit],
      migrations: [`${__dirname}/../src/migrations/*.ts`],
      synchronize: false,
    });
  try {
    const upgraded = await source(name).initialize();
    try {
      const all = [...upgraded.migrations];
      upgraded.migrations.splice(
        0,
        upgraded.migrations.length,
        ...all.filter(
          (migration) =>
            Number((migration.name ?? migration.constructor.name).slice(-13)) <
            REGISTRY_MIGRATION,
        ),
      );
      await upgraded.runMigrations({ transaction: 'all' });
      upgraded.migrations.splice(0, upgraded.migrations.length, ...all);
      await upgraded.query(
        `INSERT INTO lynx_visits (whatsapp_reference, browser) VALUES ('LX-OLD-TEST', 'old-browser')`,
      );
      assert.equal(await rowCount(upgraded), 1);
      const applied = await upgraded.runMigrations({ transaction: 'all' });
      assert.deepEqual(
        applied.slice(0, 2).map((migration) => migration.name),
        [
          'ConvertLynxVisitsToWhatsappRegistry1789521600000',
          'ExpandWhatsappContractVersion1789530710880',
        ],
      );
      assert.equal(await rowCount(upgraded), 0);
      const columns: unknown = await upgraded.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'lynx_visits'`,
      );
      assert(Array.isArray(columns));
      assert(
        !columns.some((value: unknown) => {
          if (
            value === null ||
            typeof value !== 'object' ||
            !('column_name' in value)
          )
            return false;
          return value.column_name === 'ip' || value.column_name === 'browser';
        }),
      );
      assert.equal(
        (await upgraded.runMigrations({ transaction: 'all' })).length,
        0,
      );
      const service = new WhatsappRegistryService(
        upgraded.getRepository(LynxVisit),
      );
      const input = {
        whatsapp_reference: 'LX-NEW-TEST',
        website_inquiry_id: 'wi-test',
        contract_version: 'partner-contract-version-2026.09',
      };
      assert.equal(await service.register(input), true);
      assert.equal(await service.register(input), false);
      await assert.rejects(
        service.register({ ...input, utm_source: 'different' }),
        { status: 409 },
      );
      const record = await service.resolve(input.whatsapp_reference);
      assert.equal(record.website_inquiry_id, 'wi-test');
      assert.equal(await rowCount(upgraded), 1);
    } finally {
      await upgraded.destroy();
    }

    const empty = await source(emptyName).initialize();
    try {
      await empty.runMigrations({ transaction: 'all' });
      assert.equal(
        (await empty.runMigrations({ transaction: 'all' })).length,
        0,
      );
    } finally {
      await empty.destroy();
    }
    process.stdout.write(
      'WhatsApp registry migration upgrade and empty chain OK\n',
    );
  } finally {
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.query(`DROP DATABASE ${emptyName} WITH (FORCE)`);
    await admin.destroy();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
