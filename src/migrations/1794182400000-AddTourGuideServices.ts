import { MigrationInterface, QueryRunner } from 'typeorm';

/** Breaking: the old single-guide writer must be stopped before this migration. */
export class AddTourGuideServices1794182400000 implements MigrationInterface {
  name = 'AddTourGuideServices1794182400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM tours WHERE guide_id IS NOT NULL AND drop_at < pickup_at) THEN
        RAISE EXCEPTION 'Inverted historical guide service times require explicit correction';
      END IF;
      IF EXISTS (SELECT 1 FROM tour_ratings r JOIN tours t ON t.id=r.tour_id
        WHERE t.guide_id IS DISTINCT FROM r.guide_id) THEN
        RAISE EXCEPTION 'Historical rating guide does not match the tour; retain data for review';
      END IF;
    END $$`);
    await q.query(`CREATE TABLE tour_guide_services (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tour_id uuid NOT NULL REFERENCES tours(id),
      guide_id uuid NOT NULL REFERENCES resource_guide_people(id),
      guide_name text NOT NULL,
      guide_code text NOT NULL,
      language varchar(100) NOT NULL,
      service_start_at timestamp NOT NULL,
      service_end_at timestamp NOT NULL,
      remark varchar(2000) NOT NULL DEFAULT '',
      time_source text NOT NULL CHECK (time_source IN ('legacy','manual')),
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid,
      CONSTRAINT chk_tour_guide_service_time CHECK (
        (time_source='legacy' AND service_start_at <= service_end_at)
        OR (time_source='manual' AND service_start_at < service_end_at)
      ),
      CONSTRAINT chk_tour_guide_service_precision CHECK (
        date_trunc('minute',service_start_at)=service_start_at
        AND date_trunc('minute',service_end_at)=service_end_at
      )
    )`);
    // Stable one-to-one bootstrap identity; preserve stored labels, never guess from master data.
    // Segment creation is migration work, not an invented historical human action.
    await q.query(`INSERT INTO tour_guide_services
      (id,tour_id,guide_id,guide_name,guide_code,language,service_start_at,service_end_at,time_source)
      SELECT id,id,guide_id,guide_name,guide_code,language,pickup_at,drop_at,'legacy'
      FROM tours WHERE guide_id IS NOT NULL`);
    await q.query(
      `CREATE INDEX idx_tour_guide_services_tour ON tour_guide_services(tour_id,service_start_at,id)`,
    );
    await q.query(
      `CREATE INDEX idx_tour_guide_services_occupancy ON tour_guide_services(guide_id,service_start_at,service_end_at)`,
    );
    await q.query(`ALTER TABLE tour_ratings DROP CONSTRAINT tour_ratings_pkey,
      ADD PRIMARY KEY (tour_id,guide_id)`);
    await q.query(`ALTER TABLE tours DROP CONSTRAINT chk_tours_guide_snapshot,
      DROP COLUMN guide_id, DROP COLUMN guide_name, DROP COLUMN guide_code`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Multiple guide services and ratings cannot be represented by the old schema; restore the reviewed database backup with its matching application',
      ),
    );
  }
}
