import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveResourcePriceSource1788840000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const resource of ['restaurant', 'attraction']) {
      await queryRunner.query(
        `ALTER TABLE "resource_${resource}_prices" DROP COLUMN "is_ground_operator_provided", DROP COLUMN "ground_operator_id"`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Removed source assignments cannot be recovered; restored records default to direct.
    for (const resource of ['restaurant', 'attraction']) {
      const table = `resource_${resource}_prices`;
      await queryRunner.query(`ALTER TABLE "${table}"
        ADD COLUMN "is_ground_operator_provided" boolean NOT NULL DEFAULT false,
        ADD COLUMN "ground_operator_id" uuid,
        ADD CONSTRAINT "FK_${table}_supplier" FOREIGN KEY ("ground_operator_id") REFERENCES "resource_suppliers"("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "CHK_${table}_supplier" CHECK (("is_ground_operator_provided" = false AND "ground_operator_id" IS NULL) OR ("is_ground_operator_provided" = true AND "ground_operator_id" IS NOT NULL))`);
      await queryRunner.query(
        `CREATE INDEX "IDX_${table}_supplier" ON "${table}" ("ground_operator_id") WHERE "deleted_at" IS NULL AND "ground_operator_id" IS NOT NULL`,
      );
    }
  }
}
