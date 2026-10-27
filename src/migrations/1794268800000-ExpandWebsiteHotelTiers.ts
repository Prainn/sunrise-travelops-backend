import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandWebsiteHotelTiers1794268800000 implements MigrationInterface {
  name = 'ExpandWebsiteHotelTiers1794268800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE website_hotels
      DROP CONSTRAINT website_hotels_tier_check,
      ADD CONSTRAINT website_hotels_tier_check CHECK (tier IN ('A','B','C','D'))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Existing C/D records intentionally block rollback; never rewrite business data.
    await queryRunner.query(`ALTER TABLE website_hotels
      DROP CONSTRAINT website_hotels_tier_check,
      ADD CONSTRAINT website_hotels_tier_check CHECK (tier IN ('A','B'))`);
  }
}
