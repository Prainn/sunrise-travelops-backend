import { MigrationInterface, QueryRunner } from 'typeorm';

function scheduleCheck(manualSource: string): string {
  return `CHECK (
    (schedule_mode='flight' AND pickup_flight_id IS NOT NULL AND drop_flight_id IS NOT NULL AND pickup_flight IS NOT NULL AND drop_flight IS NOT NULL)
    OR (schedule_mode='manual' AND (${manualSource}) AND pickup_flight_id IS NULL AND drop_flight_id IS NULL
      AND pickup_flight IS NULL AND drop_flight IS NULL AND pickup_at::date=start_date AND drop_at>=pickup_at
      AND occupy_from=pickup_at::date AND occupy_to=drop_at::date))`;
}

export class AddWebsiteServiceDates1796256013000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    for (const [table, count] of [
      ['website_inquiries', 'planned_days'],
      ['website_itineraries', 'duration'],
      ['tours', 'days'],
    ]) {
      const source = table === 'tours' ? "AND source_module='website'" : '';
      await q.query(`ALTER TABLE ${table} ADD COLUMN service_dates date[],
        ADD CONSTRAINT chk_${table}_service_dates CHECK (service_dates IS NULL OR
          (business_unit='website' ${source} AND array_ndims(service_dates)=1 AND array_lower(service_dates,1)=1
          AND cardinality(service_dates) BETWEEN 1 AND 365 AND array_position(service_dates,NULL) IS NULL
          AND start_date IS NOT NULL AND start_date=service_dates[1] AND ${count}=cardinality(service_dates)))`);
    }
    await q.query(
      `ALTER TABLE tours DROP CONSTRAINT chk_tours_schedule_mode, ADD CONSTRAINT chk_tours_schedule_mode ${scheduleCheck("source_module='manual' OR service_dates IS NOT NULL")}`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM website_inquiries WHERE service_dates IS NOT NULL)
        OR EXISTS (SELECT 1 FROM website_itineraries WHERE service_dates IS NOT NULL)
        OR EXISTS (SELECT 1 FROM tours WHERE service_dates IS NOT NULL) THEN
        RAISE EXCEPTION 'Selected website service dates are in use; retain the calendar';
      END IF; END $$`);
    await q.query(
      `ALTER TABLE tours DROP CONSTRAINT chk_tours_schedule_mode, ADD CONSTRAINT chk_tours_schedule_mode ${scheduleCheck("source_module='manual'")}`,
    );
    for (const table of ['tours', 'website_itineraries', 'website_inquiries'])
      await q.query(`ALTER TABLE ${table} DROP COLUMN service_dates`);
  }
}
