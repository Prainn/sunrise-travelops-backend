import { MigrationInterface, QueryRunner } from 'typeorm';

const resources = [
  ['resource_agencies', 'AGY'],
  ['resource_hotels', 'HTL'],
  ['resource_transports', 'VEH'],
  ['resource_guides', 'GDE'],
  ['resource_restaurants', 'RES'],
  ['resource_attractions', 'ATT'],
  ['resource_cities', 'CITY'],
];
const references = [
  ['inquiries', 'data'],
  ['itineraries', 'data'],
  ['inquiry_logs', 'changes'],
  ['inquiry_logs', 'metadata'],
  ['itinerary_quotes', 'snapshot'],
];

export class SequentialResourceCodes1789113600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Run in one transaction: block resource and snapshot writes until references agree.
    await q.query(
      `LOCK TABLE ${[
        ...resources.map(([table]) => table),
        ...new Set(references.map(([table]) => table)),
      ].join(', ')} IN SHARE ROW EXCLUSIVE MODE`,
    );
    await q.query(`CREATE OR REPLACE FUNCTION next_business_code(
      p_prefix text, p_at timestamptz DEFAULT clock_timestamp()
    ) RETURNS text LANGUAGE plpgsql AS $$
    DECLARE
      business_day date := (p_at AT TIME ZONE 'Asia/Shanghai')::date;
      resource_table text;
      current_max bigint;
      seq bigint;
    BEGIN
      resource_table := CASE p_prefix
        WHEN 'AGY' THEN 'resource_agencies' WHEN 'HTL' THEN 'resource_hotels'
        WHEN 'VEH' THEN 'resource_transports' WHEN 'GDE' THEN 'resource_guides'
        WHEN 'RES' THEN 'resource_restaurants' WHEN 'ATT' THEN 'resource_attractions'
        WHEN 'CITY' THEN 'resource_cities' END;
      IF resource_table IS NOT NULL THEN
        EXECUTE format('SELECT coalesce(max(split_part(code, ''-'', 2)::bigint), 0) FROM %I WHERE code ~ $1', resource_table)
          INTO current_max USING '^' || p_prefix || '-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})$';
        INSERT INTO business_code_counters(prefix, day, last_value)
          VALUES(p_prefix, DATE '0001-01-01', current_max + 1)
          ON CONFLICT(prefix, day) DO UPDATE SET last_value = greatest(
            business_code_counters.last_value + 1, excluded.last_value)
          RETURNING last_value INTO seq;
        RETURN p_prefix || '-' || lpad(seq::text, greatest(3, length(seq::text)), '0');
      END IF;
      INSERT INTO business_code_counters(prefix, day, last_value) VALUES(p_prefix, business_day, 1)
        ON CONFLICT(prefix, day) DO UPDATE SET last_value = business_code_counters.last_value + 1
        RETURNING last_value INTO seq;
      RETURN p_prefix || '-' || to_char(business_day, 'YYYYMMDD') || '-' || lpad(seq::text, greatest(2, length(seq::text)), '0');
    END $$`);

    for (const [table, prefix] of resources) {
      const pattern = `^${prefix}-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})$`;
      const rows: { id: string; code: string }[] = await q.manager.query(
        `SELECT id, code FROM ${table} WHERE code !~ $1 ORDER BY created_at, id`,
        [pattern],
      );
      for (const row of rows) {
        const [next]: { code: string }[] = await q.manager.query(
          'SELECT next_business_code($1) AS code',
          [prefix],
        );
        await q.query(`UPDATE ${table} SET code = $1 WHERE id = $2`, [
          next.code,
          row.id,
        ]);
        await q.query(
          `UPDATE inquiry_logs SET target_code = $2 WHERE target_code = $1`,
          [row.code, next.code],
        );
        for (const [referenceTable, column] of references) {
          await q.query(
            `UPDATE ${referenceTable} SET ${column} = replace(${column}::text,
            to_json($1::text)::text, to_json($2::text)::text)::jsonb
            WHERE strpos(${column}::text, to_json($1::text)::text) > 0`,
            [row.code, next.code],
          );
        }
      }
      await q.query(
        `ALTER TABLE ${table} ADD CONSTRAINT "CHK_${table}_sequential_code" CHECK (code ~ '${pattern}')`,
      );
    }
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Resource renumbering requires restoring the pre-migration backup and references together.',
      ),
    );
  }
}
