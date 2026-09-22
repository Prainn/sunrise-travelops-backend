import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveGuideServiceTotal1790040600000 implements MigrationInterface {
  name = 'RemoveGuideServiceTotal1790040600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE itinerary_quote_settings DROP COLUMN guide_service_total;
      ALTER TABLE quote_options DROP COLUMN guide_service_total;
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Restore the pre-migration database backup and matching application to recover guide service totals',
      ),
    );
  }
}
