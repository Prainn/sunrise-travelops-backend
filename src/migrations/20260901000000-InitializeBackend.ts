import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitializeBackend20260901000000 implements MigrationInterface {
  name = 'InitializeBackend20260901000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "users_status_enum" AS ENUM ('enabled', 'disabled')`,
    );
    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" varchar(100) NOT NULL,
        "name" varchar(150) NOT NULL,
        CONSTRAINT "PK_permissions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_permissions_code" UNIQUE ("code")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" varchar(60) NOT NULL,
        "name" varchar(100) NOT NULL,
        "is_enabled" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        CONSTRAINT "PK_roles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_roles_code" UNIQUE ("code")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "username" varchar(80) NOT NULL,
        "password_hash" varchar(255) NOT NULL,
        "nickname" varchar(100) NOT NULL,
        "status" "users_status_enum" NOT NULL DEFAULT 'enabled',
        "refresh_token_hash" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_username" UNIQUE ("username")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "role_permissions" (
        "role_id" uuid NOT NULL,
        "permission_id" uuid NOT NULL,
        CONSTRAINT "PK_role_permissions" PRIMARY KEY ("role_id", "permission_id"),
        CONSTRAINT "FK_role_permissions_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_role_permissions_permission" ON "role_permissions" ("permission_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "user_roles" (
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        CONSTRAINT "PK_user_roles" PRIMARY KEY ("user_id", "role_id"),
        CONSTRAINT "FK_user_roles_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_roles_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_user_roles_role" ON "user_roles" ("role_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_roles"`);
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TYPE "users_status_enum"`);
  }
}
