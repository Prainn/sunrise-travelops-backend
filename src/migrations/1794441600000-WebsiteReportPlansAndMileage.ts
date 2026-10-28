import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebsiteReportPlansAndMileage1794441600000 implements MigrationInterface {
  name = 'WebsiteReportPlansAndMileage1794441600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE website_vehicle_prices
      ADD COLUMN plan text NOT NULL DEFAULT 'A' CHECK (plan IN ('A','B')),
      ADD COLUMN includes_driver boolean NOT NULL DEFAULT true,
      ADD COLUMN includes_guide boolean NOT NULL DEFAULT false,
      DROP CONSTRAINT website_vehicle_prices_pkey,
      ADD PRIMARY KEY (itinerary_id,vehicle_type,plan)`);
    // Preserve the old implicit driver/guide facts in daily records, never change frozen output.
    await q.query(`UPDATE website_vehicle_prices p SET includes_guide=EXISTS(
      SELECT 1 FROM website_days d WHERE d.itinerary_id=p.itinerary_id
      AND NOT d.is_deleted AND btrim(d.guide_language)<>'')`);
    await q.query(`ALTER TABLE website_vehicle_prices
      ALTER COLUMN plan DROP DEFAULT, ALTER COLUMN includes_driver DROP DEFAULT,
      ALTER COLUMN includes_guide DROP DEFAULT`);
    await q.query(`CREATE TABLE website_itinerary_mileages (
      itinerary_id uuid NOT NULL REFERENCES website_itineraries(id) ON DELETE CASCADE,
      mileage_id uuid NOT NULL, position integer NOT NULL CHECK(position>=0 AND position<365),
      PRIMARY KEY(itinerary_id,mileage_id), UNIQUE(itinerary_id,position)
    )`);
    await q.query(`UPDATE website_config_versions SET config=jsonb_set(config,'{mileages}','[]'::jsonb)
      WHERE NOT config ? 'mileages'`);
  }

  async down(q: QueryRunner): Promise<void> {
    // Refuse rollback if it would discard any authored new business facts.
    await q.query(`DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM website_itinerary_mileages)
        OR EXISTS(SELECT 1 FROM website_config_versions WHERE jsonb_array_length(config->'mileages')>0)
        OR EXISTS(SELECT 1 FROM website_vehicle_prices p WHERE plan<>'A' OR NOT includes_driver
          OR includes_guide<>EXISTS(SELECT 1 FROM website_days d WHERE d.itinerary_id=p.itinerary_id AND NOT d.is_deleted AND btrim(d.guide_language)<>''))
      THEN RAISE EXCEPTION 'Website report data prevents rollback'; END IF;
    END $$`);
    await q.query('DROP TABLE website_itinerary_mileages');
    await q.query(`ALTER TABLE website_vehicle_prices DROP CONSTRAINT website_vehicle_prices_pkey,
      DROP COLUMN plan, DROP COLUMN includes_driver, DROP COLUMN includes_guide,
      ADD PRIMARY KEY(itinerary_id,vehicle_type)`);
    await q.query(
      `UPDATE website_config_versions SET config=config-'mileages'`,
    );
  }
}
