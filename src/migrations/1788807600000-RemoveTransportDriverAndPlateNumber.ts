import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveTransportDriverAndPlateNumber1788807600000 implements MigrationInterface {
  name = 'RemoveTransportDriverAndPlateNumber1788807600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "resource_transports"
      DROP COLUMN "contact",
      DROP COLUMN "plate_number"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "resource_transports"
      ADD COLUMN "plate_number" varchar(50) NOT NULL DEFAULT '',
      ADD COLUMN "contact" varchar(100) NOT NULL DEFAULT ''
    `);
  }
}
