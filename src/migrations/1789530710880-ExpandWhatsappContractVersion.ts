import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandWhatsappContractVersion1789530710880 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lynx_visits"
        ALTER COLUMN "contract_version" TYPE varchar(2048)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lynx_visits"
        ALTER COLUMN "contract_version" TYPE varchar(16)
    `);
  }
}
