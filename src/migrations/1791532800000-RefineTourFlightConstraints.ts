import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefineTourFlightConstraints1791532800000 implements MigrationInterface {
  name = 'RefineTourFlightConstraints1791532800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX "UQ_resource_flights_schedule"');
    // Unmapped historical rows retain their original uniqueness rule.
    await q.query(`CREATE UNIQUE INDEX "UQ_resource_flights_schedule"
      ON resource_flights (library, departure_city, arrival_city, flight_number, departure_time, arrival_time)
      WHERE deleted_at IS NULL AND (departure_airport_id IS NULL OR arrival_airport_id IS NULL)`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Airport-specific schedules require a reviewed restore plan'),
    );
  }
}
