import { MigrationInterface, QueryRunner } from 'typeorm';

export class GuideScheduleConfirmations1796083200000 implements MigrationInterface {
  name = 'GuideScheduleConfirmations1796083200000';
  async up(q: QueryRunner): Promise<void> {
    // Raw historical timestamps and audit are deliberately left intact.
    await q.query(`ALTER TABLE tour_guide_services ADD COLUMN conflict_confirmation jsonb;
      CREATE TABLE tour_guide_conflict_confirmations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tour_id uuid NOT NULL REFERENCES tours(id), service_id uuid NOT NULL,
        guide_id uuid NOT NULL REFERENCES resource_guide_people(id),
        confirmation jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL
      );
      CREATE INDEX idx_guide_confirmation_tour ON tour_guide_conflict_confirmations(tour_id,created_at);
      CREATE INDEX idx_guide_service_dates ON tour_guide_services(guide_id,(service_start_at::date),(service_end_at::date));`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM tour_guide_conflict_confirmations) THEN
      RAISE EXCEPTION 'Guide confirmation audit must be retained'; END IF; END $$;
      DROP TABLE tour_guide_conflict_confirmations;
      DROP INDEX idx_guide_service_dates;
      ALTER TABLE tour_guide_services DROP COLUMN conflict_confirmation;`);
  }
}
