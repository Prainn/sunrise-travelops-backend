import { MigrationInterface, QueryRunner } from 'typeorm';

const tables = [
  'resource_agencies',
  'resource_hotels',
  'resource_transports',
  'resource_guides',
  'resource_restaurants',
  'resource_attractions',
  'resource_cities',
];

export class BoundResourceCodeSequences1795046400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Validate existing rows; never rewrite business codes or historical references.
    for (const table of tables)
      await q.query(
        `ALTER TABLE ${table} ADD CONSTRAINT "CHK_${table}_code_range" CHECK(length(split_part(code, '-', 2)) <= 18)`,
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
        IF seq > 999999999999999999 THEN
          RAISE EXCEPTION 'Resource code sequence exhausted' USING ERRCODE = '23514';
        END IF;
        RETURN p_prefix || '-' || lpad(seq::text, greatest(3, length(seq::text)), '0');
      END IF;
      INSERT INTO business_code_counters(prefix, day, last_value) VALUES(p_prefix, business_day, 1)
        ON CONFLICT(prefix, day) DO UPDATE SET last_value = business_code_counters.last_value + 1
        RETURNING last_value INTO seq;
      RETURN p_prefix || '-' || to_char(business_day, 'YYYYMMDD') || '-' || lpad(seq::text, greatest(2, length(seq::text)), '0');
    END $$`);
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of tables)
      await q.query(
        `ALTER TABLE ${table} DROP CONSTRAINT "CHK_${table}_code_range"`,
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
  }
}
