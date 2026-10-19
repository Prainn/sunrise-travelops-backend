import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowManualToursAndGuideSnapshots1792368000000 implements MigrationInterface {
  name = 'AllowManualToursAndGuideSnapshots1792368000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tours
      DROP CONSTRAINT tours_source_module_check,
      ADD CONSTRAINT tours_source_module_check CHECK (source_module IN ('standard','website','manual')),
      ALTER COLUMN inquiry_id DROP NOT NULL,
      ALTER COLUMN quote_id DROP NOT NULL,
      ALTER COLUMN itinerary_id DROP NOT NULL,
      ALTER COLUMN inquiry_code DROP NOT NULL,
      ALTER COLUMN quote_code DROP NOT NULL,
      ALTER COLUMN itinerary_code DROP NOT NULL,
      ALTER COLUMN pickup_flight_id DROP NOT NULL,
      ALTER COLUMN drop_flight_id DROP NOT NULL,
      ALTER COLUMN pickup_flight DROP NOT NULL,
      ALTER COLUMN drop_flight DROP NOT NULL,
      ADD COLUMN schedule_mode text NOT NULL DEFAULT 'flight',
      ADD COLUMN itinerary_summary varchar(500) NOT NULL DEFAULT '',
      ADD COLUMN guide_name text,
      ADD COLUMN guide_code text`);
    // Historical labels are the current master-data values, not reconstructed past names.
    await q.query(`UPDATE tours t SET guide_name=g.name, guide_code=g.code
      FROM resource_guide_people g WHERE g.id=t.guide_id`);
    await q.query(`ALTER TABLE tours ADD CONSTRAINT chk_tours_source_relation CHECK (
      (source_module='manual' AND inquiry_id IS NULL AND quote_id IS NULL AND itinerary_id IS NULL
       AND inquiry_code IS NULL AND quote_code IS NULL AND itinerary_code IS NULL AND length(trim(itinerary_summary)) > 0)
      OR (source_module IN ('standard','website') AND inquiry_id IS NOT NULL AND quote_id IS NOT NULL
       AND itinerary_id IS NOT NULL AND inquiry_code IS NOT NULL AND quote_code IS NOT NULL AND itinerary_code IS NOT NULL)
    ), ADD CONSTRAINT chk_tours_schedule_mode CHECK (
      (schedule_mode='flight' AND pickup_flight_id IS NOT NULL AND drop_flight_id IS NOT NULL
       AND pickup_flight IS NOT NULL AND drop_flight IS NOT NULL)
      OR (schedule_mode='manual' AND source_module='manual' AND pickup_flight_id IS NULL AND drop_flight_id IS NULL
       AND pickup_flight IS NULL AND drop_flight IS NULL AND pickup_at::date=start_date AND drop_at>=pickup_at
       AND occupy_from=pickup_at::date AND occupy_to=drop_at::date)
    ), ADD CONSTRAINT chk_tours_guide_snapshot CHECK (
      (guide_id IS NULL AND guide_name IS NULL AND guide_code IS NULL)
      OR (guide_id IS NOT NULL AND guide_name IS NOT NULL AND guide_code IS NOT NULL)
    )`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Manual tours cannot be represented by the old schema; retain data and use a reviewed recovery plan',
      ),
    );
  }
}
