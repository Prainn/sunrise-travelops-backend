import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserProfileFields1788199200000 implements MigrationInterface {
  name = 'AddUserProfileFields1788199200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "avatar" varchar(500) NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "gender" smallint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "mobile" varchar(30) NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email" varchar(254) NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "dept_id" integer`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_gender" CHECK ("gender" IN (0, 1, 2))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_gender"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "dept_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "mobile"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "gender"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatar"`);
  }
}
