import { MigrationInterface, QueryRunner } from 'typeorm';
export class SeriesInquiries1796083202000 implements MigrationInterface {
  name = 'SeriesInquiries1796083202000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE inquiries ADD COLUMN is_series boolean NOT NULL DEFAULT false,
      ALTER COLUMN agency_id DROP NOT NULL, ALTER COLUMN contact_id DROP NOT NULL, ALTER COLUMN planned_days DROP NOT NULL;
      ALTER TABLE inquiries ADD CONSTRAINT chk_series_inquiry CHECK (
        (is_series AND business_unit='shengxu' AND agency_id IS NULL AND contact_id IS NULL AND planned_days IS NULL)
        OR (NOT is_series AND agency_id IS NOT NULL AND contact_id IS NOT NULL AND planned_days IS NOT NULL));
      ALTER TABLE tours ADD COLUMN is_series_source boolean NOT NULL DEFAULT false;
      CREATE FUNCTION set_tour_series_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        NEW.is_series_source := NEW.source_module='standard' AND COALESCE((SELECT is_series FROM inquiries WHERE id=NEW.inquiry_id),false);
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_tour_series_source BEFORE INSERT OR UPDATE OF source_module,inquiry_id,is_series_source ON tours
        FOR EACH ROW EXECUTE FUNCTION set_tour_series_source();
      DROP INDEX uq_tours_active_inquiry;
      CREATE UNIQUE INDEX uq_tours_active_inquiry ON tours(source_module,inquiry_id) WHERE status='active' AND NOT is_series_source;`);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Series inquiries and repeated tours cannot be represented by the old schema; restore reviewed matching backup',
      ),
    );
  }
}
