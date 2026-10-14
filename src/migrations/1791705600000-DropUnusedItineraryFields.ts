import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropUnusedItineraryFields1791705600000 implements MigrationInterface {
  name = 'DropUnusedItineraryFields1791705600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE itineraries DROP COLUMN adults, DROP COLUMN children_count, DROP COLUMN leader_count;
      ALTER TABLE itinerary_quote_options DROP COLUMN adult_unit_price, DROP COLUMN leader_foc_enabled;
      ALTER TABLE itinerary_quote_settings DROP COLUMN other_expenses;
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Restore the pre-cleanup database backup to recover removed itinerary fields',
      ),
    );
  }
}
