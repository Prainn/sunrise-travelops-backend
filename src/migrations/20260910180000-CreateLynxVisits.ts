import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLynxVisits20260910180000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "lynx_visits" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "whatsapp_reference" varchar(128) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "ip" inet,
        "browser" text NOT NULL,
        CONSTRAINT "PK_lynx_visits" PRIMARY KEY ("id")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "lynx_visits"');
  }
}
