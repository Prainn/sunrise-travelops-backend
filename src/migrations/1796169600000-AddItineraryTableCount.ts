import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddItineraryTableCount1796169600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE itinerary_items ADD COLUMN table_count integer CHECK (table_count IS NULL OR (table_count BETWEEN 1 AND 10000 AND unit = 'table' AND type = 'restaurant'))`,
    );
    await queryRunner.query(
      `ALTER TABLE quote_resource_lines ADD COLUMN table_count integer CHECK (table_count IS NULL OR (table_count BETWEEN 1 AND 10000 AND unit = 'table' AND type = 'restaurant'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE quote_resource_lines DROP COLUMN table_count',
    );
    await queryRunner.query(
      'ALTER TABLE itinerary_items DROP COLUMN table_count',
    );
  }
}
