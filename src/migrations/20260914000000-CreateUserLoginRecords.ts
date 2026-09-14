import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserLoginRecords20260914000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "user_login_records" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL,
      "time" timestamptz NOT NULL DEFAULT now(),
      "ip" varchar(64) NOT NULL,
      "user_agent" varchar(512) NOT NULL,
      CONSTRAINT "PK_user_login_records" PRIMARY KEY ("id"),
      CONSTRAINT "FK_user_login_records_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      'CREATE INDEX "IDX_user_login_records_user_time" ON "user_login_records" ("user_id", "time", "id")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "user_login_records"');
  }
}
