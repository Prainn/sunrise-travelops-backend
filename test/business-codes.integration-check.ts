/** Explicit local database check; preview migrations and business fixtures are rolled back. */
import assert from 'node:assert/strict';
import db from '../src/database/data-source';
import { ReadableBusinessCodes1788867600000 } from '../src/migrations/1788867600000-ReadableBusinessCodes';

async function main() {
  await db.initialize();
  const runner = db.createQueryRunner();
  await runner.connect();
  try {
    if (process.argv.includes('--preview-migration')) {
      await runner.startTransaction();
      const original: unknown = await runner.manager.query(
        'SELECT id, code FROM inquiries UNION ALL SELECT id, code FROM itineraries ORDER BY id',
      );
      const migration = new ReadableBusinessCodes1788867600000();
      await migration.up(runner);
      assert.equal(await runner.hasTable('business_code_rewrites'), false);
      const mismatches: unknown[] = await runner.manager.query(
        `SELECT l.id FROM inquiry_logs l JOIN inquiries i ON i.id = l.inquiry_id WHERE l.inquiry_code <> i.code`,
      );
      assert.equal(mismatches.length, 0);
      const quoteMismatches: unknown[] = await runner.manager
        .query(`SELECT q.id FROM itinerary_quotes q JOIN itineraries t ON t.id = q.itinerary_id JOIN inquiries i ON i.id = t.inquiry_id
        WHERE q.snapshot->'itinerary'->>'code' <> t.code OR q.snapshot->'inquiry'->>'code' <> i.code OR q.snapshot->>'quoteCode' <> t.code || '-V1'`);
      assert.equal(quoteMismatches.length, 0);
      for (let i = 1; i <= 101; i++) {
        const rows: { code: string }[] = await runner.manager.query(
          "SELECT next_business_code('CODETEST', '2026-09-08T15:59:59Z') AS code",
        );
        assert.equal(
          rows[0].code,
          `CODETEST-20260908-${String(i).padStart(2, '0')}`,
        );
      }
      const rows: { code: string }[] = await runner.manager.query(
        "SELECT next_business_code('CODETEST', '2026-09-08T16:00:00Z') AS code",
      );
      assert.equal(rows[0].code, 'CODETEST-20260909-01');
      await runner.rollbackTransaction();
      assert.deepEqual(
        await runner.manager.query(
          'SELECT id, code FROM inquiries UNION ALL SELECT id, code FROM itineraries ORDER BY id',
        ),
        original,
      );
      console.log(
        JSON.stringify({
          result: 'passed',
          checks: [
            'migration without persistent backup',
            'log references',
            'frozen quote references',
            'over 99',
            'Shanghai midnight',
          ],
          changes: 'rolled back',
        }),
      );
    } else {
      const existing: unknown[] = await runner.manager.query(
        "SELECT 1 FROM business_code_counters WHERE prefix = 'CODETEST'",
      );
      assert.equal(existing.length, 0);
      try {
        const codes = await Promise.all(
          Array.from({ length: 12 }, async () => {
            const rows: { code: string }[] = await db.query(
              "SELECT next_business_code('CODETEST', '2026-09-08T00:00:00Z') AS code",
            );
            return rows[0].code;
          }),
        );
        assert.equal(new Set(codes).size, 12);
        assert(
          codes.includes('CODETEST-20260908-01') &&
            codes.includes('CODETEST-20260908-12'),
        );
        console.log(
          JSON.stringify({ result: 'passed', concurrentNumbers: codes.length }),
        );
      } finally {
        await runner.manager.query(
          "DELETE FROM business_code_counters WHERE prefix = 'CODETEST'",
        );
      }
    }
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    await db.destroy();
  }
}
void main();
