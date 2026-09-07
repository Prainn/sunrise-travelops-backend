import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransportServiceLevel1788804000000 implements MigrationInterface {
  name = 'AddTransportServiceLevel1788804000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "resource_transports"
      ADD COLUMN "service_level" varchar(20) NOT NULL DEFAULT 'standard'
    `);
    await queryRunner.query(`
      ALTER TABLE "resource_transports"
      ALTER COLUMN "service_level" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "resource_transports"
      ADD CONSTRAINT "CHK_resource_transports_service_level"
      CHECK ("service_level" IN ('standard', 'vip'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "resource_transports"
      DROP CONSTRAINT "CHK_resource_transports_service_level"
    `);
    await queryRunner.query(`
      ALTER TABLE "resource_transports"
      DROP COLUMN "service_level"
    `);
  }
}
