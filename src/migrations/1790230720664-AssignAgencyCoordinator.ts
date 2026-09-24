import { MigrationInterface, QueryRunner } from 'typeorm';

export class AssignAgencyCoordinator1790230720664 implements MigrationInterface {
  name = 'AssignAgencyCoordinator1790230720664';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resource_agencies" ADD "business_unit" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_agencies" ADD "coordinator_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_agencies" ADD CONSTRAINT "CHK_resource_agencies_business_unit" CHECK ("business_unit" IS NULL OR "business_unit" IN ('shengxu', 'linxi', 'website'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_agencies" ADD CONSTRAINT "FK_resource_agencies_coordinator" FOREIGN KEY ("coordinator_id") REFERENCES "users"("id") ON DELETE RESTRICT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resource_agencies" DROP CONSTRAINT "FK_resource_agencies_coordinator"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_agencies" DROP CONSTRAINT "CHK_resource_agencies_business_unit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_agencies" DROP COLUMN "coordinator_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resource_agencies" DROP COLUMN "business_unit"`,
    );
  }
}
