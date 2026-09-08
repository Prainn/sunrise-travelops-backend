import { MigrationInterface, QueryRunner } from 'typeorm';

const domains = [
  ['inquiries', 'INQ'],
  ['itineraries', 'ITI'],
  ['resource_agencies', 'AGY'],
  ['resource_hotels', 'HTL'],
  ['resource_transports', 'VEH'],
  ['resource_guides', 'GDE'],
  ['resource_restaurants', 'RES'],
  ['resource_attractions', 'ATT'],
  ['resource_suppliers', 'SUP'],
  ['resource_cities', 'CITY'],
];

export class ReadableBusinessCodes1788867600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.manager.query(`CREATE TABLE business_code_counters (
      prefix varchar(10) NOT NULL, day date NOT NULL, last_value bigint NOT NULL,
      PRIMARY KEY (prefix, day)
    )`);
    await q.manager
      .query(`CREATE FUNCTION next_business_code(p_prefix text, p_at timestamptz DEFAULT clock_timestamp())
      RETURNS text LANGUAGE plpgsql AS $$
      DECLARE business_day date := (p_at AT TIME ZONE 'Asia/Shanghai')::date;
        seq bigint;
      BEGIN
        INSERT INTO business_code_counters(prefix, day, last_value) VALUES(p_prefix, business_day, 1)
        ON CONFLICT (prefix, day) DO UPDATE SET last_value = business_code_counters.last_value + 1
        RETURNING last_value INTO seq;
        RETURN p_prefix || '-' || to_char(business_day, 'YYYYMMDD') || '-' || lpad(seq::text, greatest(2, length(seq::text)), '0');
      END $$`);
    for (const [table, prefix] of domains) {
      await q.manager.query(`LOCK TABLE "${table}" IN ACCESS EXCLUSIVE MODE`);
      await q.manager.query(
        `INSERT INTO business_code_counters(prefix, day, last_value)
        SELECT $1, to_date(split_part(code, '-', 2), 'YYYYMMDD'), max(split_part(code, '-', 3)::bigint)
        FROM "${table}" WHERE code ~ $2 GROUP BY split_part(code, '-', 2)
        ON CONFLICT(prefix, day) DO UPDATE SET last_value = greatest(business_code_counters.last_value, excluded.last_value)`,
        [prefix, '^' + prefix + '-[0-9]{8}-[0-9]{2,}$'],
      );
      const rows: { id: string; code: string; created_at: Date }[] =
        await q.manager.query(
          `SELECT id, code, created_at FROM "${table}" WHERE code ${table.startsWith('resource_') ? '~' : '!~'} $1 ORDER BY created_at, id`,
          [
            table.startsWith('resource_')
              ? '^[A-Z]+-[0-9a-f]{8}-[0-9a-f-]{27}$'
              : '^' + prefix + '-[0-9]{8}-[0-9]{2,}$',
          ],
        );
      for (const row of rows) {
        const [next]: { code: string }[] = await q.manager.query(
          'SELECT next_business_code($1, $2) AS code',
          [prefix, row.created_at],
        );
        await q.manager.query(`UPDATE "${table}" SET code = $1 WHERE id = $2`, [
          next.code,
          row.id,
        ]);
        await this.rewriteReferences(q, row.code, next.code);
      }
    }
  }

  private async rewriteReferences(
    q: QueryRunner,
    oldCode: string,
    newCode: string,
  ) {
    await q.manager.query(
      `UPDATE inquiry_logs SET
      inquiry_code = CASE WHEN inquiry_code = $1 THEN $2 ELSE inquiry_code END,
      target_code = CASE WHEN target_code = $1 THEN $2 ELSE target_code END
      WHERE inquiry_code = $1 OR target_code = $1`,
      [oldCode, newCode],
    );
    for (const [table, column] of [
      ['inquiries', 'data'],
      ['itineraries', 'data'],
      ['inquiry_logs', 'changes'],
      ['inquiry_logs', 'metadata'],
      ['itinerary_quotes', 'snapshot'],
    ]) {
      // Replace whole JSON string values only, including the derived quote code.
      await q.manager.query(
        `UPDATE "${table}" SET "${column}" = replace(replace("${column}"::text,
        to_json($1::text)::text, to_json($2::text)::text),
        to_json($1::text || '-V1')::text, to_json($2::text || '-V1')::text)::jsonb
        WHERE strpos("${column}"::text, $1) > 0`,
        [oldCode, newCode],
      );
    }
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Business code renumbering is irreversible; old UUID codes are not retained.',
      ),
    );
  }
}
