import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGuidePeople1789488100000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "resource_guide_people" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "library" text NOT NULL REFERENCES "resource_libraries"("code"),
      "code" varchar(50) NOT NULL,
      "name" varchar(150) NOT NULL,
      "gender" integer NOT NULL DEFAULT 0,
      "certificate_no" text,
      "identity_number" text,
      "status" varchar(20) NOT NULL DEFAULT 'enabled',
      "version" integer NOT NULL DEFAULT 1,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "created_by" uuid,
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "updated_by" uuid,
      "deleted_at" timestamptz,
      CONSTRAINT "PK_resource_guide_people" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_resource_guide_people_code" UNIQUE ("code"),
      CONSTRAINT "CHK_resource_guide_people_gender" CHECK ("gender" IN (0,1,2)),
      CONSTRAINT "CHK_resource_guide_people_status" CHECK ("status" IN ('enabled','disabled'))
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_resource_guide_people_library_status"
      ON "resource_guide_people" ("library", "status") WHERE "deleted_at" IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "resource_guide_people"');
  }
}
