import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddItineraryDayRecycle1792627200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    for (const table of ['itinerary_days', 'website_days']) {
      await q.query(
        `ALTER TABLE ${table} ADD COLUMN is_deleted boolean NOT NULL DEFAULT false, ADD COLUMN original_date text`,
      );
      await q.query(
        `ALTER TABLE ${table} DROP CONSTRAINT ${table}_itinerary_id_day_number_key`,
      );
      await q.query(
        `CREATE UNIQUE INDEX ${table}_active_day_number_key ON ${table}(itinerary_id,day_number) WHERE NOT is_deleted`,
      );
    }
    await q.query(`ALTER TABLE website_days ALTER COLUMN depart_city_id DROP NOT NULL, ALTER COLUMN end_city_id DROP NOT NULL,
      ADD CONSTRAINT website_days_active_cities_check CHECK(is_deleted OR (depart_city_id IS NOT NULL AND end_city_id IS NOT NULL))`);
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of ['itinerary_days', 'website_days']) {
      const rows = (await q.query(
        `SELECT count(*)::text AS count FROM ${table} WHERE is_deleted`,
      )) as { count: string }[];
      if (Number(rows[0].count))
        throw new Error(
          'Restore deleted itinerary days before reverting this migration',
        );
    }
    await q.query(
      `ALTER TABLE website_days DROP CONSTRAINT website_days_active_cities_check, ALTER COLUMN depart_city_id SET NOT NULL, ALTER COLUMN end_city_id SET NOT NULL`,
    );
    for (const table of ['itinerary_days', 'website_days']) {
      await q.query(`DROP INDEX ${table}_active_day_number_key`);
      await q.query(
        `ALTER TABLE ${table} DROP COLUMN is_deleted, DROP COLUMN original_date, ADD UNIQUE(itinerary_id,day_number)`,
      );
    }
  }
}
