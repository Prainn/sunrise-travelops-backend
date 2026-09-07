import { MigrationInterface, QueryRunner } from 'typeorm';

export class RequireGuideGroundOperator1788544800000 implements MigrationInterface {
  name = 'RequireGuideGroundOperator1788544800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "resource_guides"
          WHERE "daily_price" IS NULL OR "ground_operator_id" IS NULL
        ) THEN
          RAISE EXCEPTION 'Every guide must have a daily price and ground operator before this migration can run';
        END IF;
      END
      $$
    `);
    await queryRunner.query(`DROP INDEX "IDX_resource_guides_supplier"`);
    await queryRunner.query(
      `ALTER TABLE "resource_guides" DROP CONSTRAINT "CHK_resource_guides_supplier"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_guides" DROP CONSTRAINT "CHK_resource_guides_daily_price"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_guides" ALTER COLUMN "daily_price" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_guides" ALTER COLUMN "ground_operator_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_guides" DROP COLUMN "is_ground_operator_provided"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_guides" ADD CONSTRAINT "CHK_resource_guides_daily_price" CHECK ("daily_price" >= 0)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_guides_supplier" ON "resource_guides" ("ground_operator_id") WHERE "deleted_at" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_resource_guides_supplier"`);
    await queryRunner.query(
      `ALTER TABLE "resource_guides" DROP CONSTRAINT "CHK_resource_guides_daily_price"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_guides" ADD "is_ground_operator_provided" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_guides" ALTER COLUMN "ground_operator_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_guides" ALTER COLUMN "daily_price" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_guides" ADD CONSTRAINT "CHK_resource_guides_daily_price" CHECK ("daily_price" IS NULL OR "daily_price" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_guides" ADD CONSTRAINT "CHK_resource_guides_supplier" CHECK (("is_ground_operator_provided" = false AND "ground_operator_id" IS NULL) OR ("is_ground_operator_provided" = true AND "ground_operator_id" IS NOT NULL))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_guides_supplier" ON "resource_guides" ("ground_operator_id") WHERE "deleted_at" IS NULL AND "ground_operator_id" IS NOT NULL`,
    );
  }
}
