import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuoteOtherCosts1790006700000 implements MigrationInterface {
  name = 'AddQuoteOtherCosts1790006700000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE itinerary_quote_settings
      ADD COLUMN meal_other_cost numeric CHECK(meal_other_cost>=0),
      ADD COLUMN meal_other_reason text NOT NULL DEFAULT '',
      ADD COLUMN attraction_other_cost numeric CHECK(attraction_other_cost>=0),
      ADD COLUMN attraction_other_reason text NOT NULL DEFAULT ''`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Retain quote other costs when rolling back the application'),
    );
  }
}
