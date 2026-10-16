import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowNullDraftActualPrices1792195200000 implements MigrationInterface {
  name = 'AllowNullDraftActualPrices1792195200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE itinerary_hotels ALTER COLUMN unit_cost DROP NOT NULL;
      ALTER TABLE itinerary_guides ALTER COLUMN daily_price DROP NOT NULL;
      ALTER TABLE itinerary_items ALTER COLUMN unit_cost DROP NOT NULL,
        ALTER COLUMN total_cost DROP NOT NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // SET NOT NULL fails atomically if a Draft still has unfilled prices.
    // Never invent a zero price to make an old application accept it.
    await queryRunner.query(`
      ALTER TABLE itinerary_hotels ALTER COLUMN unit_cost SET NOT NULL;
      ALTER TABLE itinerary_guides ALTER COLUMN daily_price SET NOT NULL;
      ALTER TABLE itinerary_items ALTER COLUMN unit_cost SET NOT NULL,
        ALTER COLUMN total_cost SET NOT NULL;
    `);
  }
}
