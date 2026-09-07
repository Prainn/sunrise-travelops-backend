import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConstrainHotelRating1788811200000 implements MigrationInterface {
  name = 'ConstrainHotelRating1788811200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "resource_hotels"
      ALTER COLUMN "rating" DROP DEFAULT
    `);
    await queryRunner.query(`
      UPDATE "resource_hotels"
      SET "rating" = CASE
        WHEN "rating" IN ('五星', 'international_five_star') THEN 'international_five_star'
        ELSE 'ctrip_preferred'
      END
    `);
    await queryRunner.query(`
      ALTER TABLE "resource_hotels"
      ADD CONSTRAINT "CHK_resource_hotels_rating"
      CHECK ("rating" IN ('international_five_star', 'ctrip_preferred'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "resource_hotels"
      DROP CONSTRAINT "CHK_resource_hotels_rating"
    `);
    await queryRunner.query(`
      UPDATE "resource_hotels"
      SET "rating" = CASE
        WHEN "rating" = 'international_five_star' THEN '五星'
        ELSE '四星'
      END
    `);
    await queryRunner.query(`
      ALTER TABLE "resource_hotels"
      ALTER COLUMN "rating" SET DEFAULT ''
    `);
  }
}
