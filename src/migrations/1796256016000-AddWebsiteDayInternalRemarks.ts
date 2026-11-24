import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebsiteDayInternalRemarks1796256016000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Older releases replace day rows during every save. Anchor notes to the
    // itinerary so a rewrite of the same day IDs preserves their notes.
    await runner.query(`CREATE TABLE website_day_internal_remarks (
      itinerary_id uuid NOT NULL REFERENCES website_itineraries(id) ON DELETE CASCADE,
      day_id uuid NOT NULL,
      internal_remark varchar(200) NOT NULL CHECK (internal_remark <> ''),
      PRIMARY KEY (itinerary_id, day_id)
    )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM website_day_internal_remarks) THEN
        RAISE EXCEPTION 'Website day internal remarks are in use';
      END IF;
    END $$`);
    await runner.query('DROP TABLE website_day_internal_remarks');
  }
}
