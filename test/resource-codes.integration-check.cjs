// Run with node -r ts-node/register test/resource-codes.integration-check.cjs
// Requires a fresh disposable PostgreSQL on localhost:55439; never uses .env.
const assert = require('node:assert/strict');
const { DataSource } = require(process.cwd() + '/node_modules/typeorm');
const { SequentialResourceCodes1789113600000 } = require(
  process.cwd() + '/src/migrations/1789113600000-SequentialResourceCodes',
);
const resources = [
  ['resource_agencies', 'AGY'],
  ['resource_hotels', 'HTL'],
  ['resource_transports', 'VEH'],
  ['resource_guides', 'GDE'],
  ['resource_restaurants', 'RES'],
  ['resource_attractions', 'ATT'],
  ['resource_cities', 'CITY'],
];
const opts = {
  type: 'postgres',
  host: '127.0.0.1',
  port: 55439,
  username: 'postgres',
  password: 'resource-codes-test',
  database: 'postgres',
};
(async () => {
  const db = new DataSource({
    ...opts,
    migrations: [process.cwd() + '/src/migrations/*.ts'],
  });
  await db.initialize();
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await db.runMigrations({ transaction: 'all' });
    assert.equal((await db.runMigrations()).length, 0);
    console.log('PASS all empty-database migrations and repeat execution');
    await db.query('CREATE DATABASE resource_fixture');
  } finally {
    await db.destroy();
  }
  const fixture = new DataSource({
    ...opts,
    database: 'resource_fixture',
    migrations: [SequentialResourceCodes1789113600000],
  });
  await fixture.initialize();
  try {
    await fixture.query(
      'CREATE TABLE business_code_counters(prefix varchar(10), day date, last_value bigint, PRIMARY KEY(prefix,day))',
    );
    for (const [table, prefix] of resources) {
      await fixture.query(
        `CREATE TABLE ${table}(id text PRIMARY KEY, code text UNIQUE, created_at timestamptz DEFAULT now(), deleted_at timestamptz, name text)`,
      );
      await fixture.query(
        `INSERT INTO ${table}(id,code,deleted_at,name) VALUES ('old',$1,null,'kept'),('deleted',$2,now(),'deleted'),('dated',$3,null,'converted')`,
        [prefix + '-001', prefix + '-012', prefix + '-20260908-02'],
      );
    }
    await fixture.query(
      'CREATE TABLE inquiries(id text, code text, data jsonb)',
    );
    await fixture.query(
      'CREATE TABLE itineraries(id text, code text, data jsonb)',
    );
    await fixture.query(
      'CREATE TABLE inquiry_logs(id text, target_code text, changes jsonb, metadata jsonb)',
    );
    await fixture.query(
      'CREATE TABLE itinerary_quotes(id text, snapshot jsonb)',
    );
    const snapshot = JSON.stringify({
      nested: [
        {
          restaurantCode: 'RES-20260908-02',
          hotelCode: 'HTL-20260908-02',
          freeText: 'Visit RES-20260908-02 today',
        },
      ],
    });
    await fixture.query('INSERT INTO inquiries VALUES ($1,$2,$3)', [
      'inq',
      'INQ-20260908-01',
      snapshot,
    ]);
    await fixture.query('INSERT INTO itineraries VALUES ($1,$2,$3)', [
      'iti',
      'ITI-20260908-01',
      snapshot,
    ]);
    await fixture.query('INSERT INTO inquiry_logs VALUES ($1,$2,$3,$3)', [
      'log',
      'RES-20260908-02',
      snapshot,
    ]);
    await fixture.query('INSERT INTO itinerary_quotes VALUES ($1,$2)', [
      'quote',
      snapshot,
    ]);
    await fixture.runMigrations({ transaction: 'all' });
    for (const [table, prefix] of resources) {
      const rows = await fixture.query(
        `SELECT id,code,name,deleted_at FROM ${table} ORDER BY id`,
      );
      assert.equal(rows.find((r) => r.id === 'dated').code, prefix + '-013');
      assert.equal(rows.find((r) => r.id === 'deleted').code, prefix + '-012');
      assert(rows.find((r) => r.id === 'deleted').deleted_at);
      await assert.rejects(
        fixture.query(`UPDATE ${table} SET code=$1 WHERE id='dated'`, [
          prefix + '-20260911-01',
        ]),
        (e) => e.code === '23514',
      );
    }
    for (const [table, col] of [
      ['inquiries', 'data'],
      ['itineraries', 'data'],
      ['inquiry_logs', 'changes'],
      ['inquiry_logs', 'metadata'],
      ['itinerary_quotes', 'snapshot'],
    ]) {
      const row = (
        await fixture.query(`SELECT ${col} AS value FROM ${table}`)
      )[0].value;
      assert.equal(row.nested[0].restaurantCode, 'RES-013');
      assert.equal(row.nested[0].hotelCode, 'HTL-013');
      assert.equal(row.nested[0].freeText, 'Visit RES-20260908-02 today');
    }
    const codes = await Promise.all(
      Array.from({ length: 12 }, () =>
        fixture.query("SELECT next_business_code('RES') AS code"),
      ),
    );
    assert.equal(new Set(codes.map((r) => r[0].code)).size, 12);
    assert.equal(
      (
        await fixture.query(
          "SELECT next_business_code('RES','2030-01-01') AS code",
        )
      )[0].code,
      'RES-026',
    );
    await fixture.query(
      "INSERT INTO resource_restaurants(id,code) VALUES ('manual','RES-999')",
    );
    assert.equal(
      (await fixture.query("SELECT next_business_code('RES') AS code"))[0].code,
      'RES-1000',
    );
    assert.equal(
      (
        await fixture.query(
          "SELECT next_business_code('INQ','2026-09-08T16:00:00Z') AS code",
        )
      )[0].code,
      'INQ-20260909-01',
    );
    assert.equal((await fixture.runMigrations()).length, 0);
    console.log(
      'PASS old data and soft deletions, all reference columns, constraints, concurrency, no daily reset, manual maximum, overflow beyond 999, inquiry date rules',
    );
  } finally {
    await fixture.destroy();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
