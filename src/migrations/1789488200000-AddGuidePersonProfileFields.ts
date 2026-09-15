import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuidePersonProfileFields1789488200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "resource_guide_people"
      ADD COLUMN "age" integer,
      ADD COLUMN "contact" text,
      ADD COLUMN "employment_type" text,
      ADD COLUMN "has_labor_contract" boolean,
      ADD COLUMN "remark" text,
      ADD CONSTRAINT "CHK_resource_guide_people_age" CHECK ("age" IS NULL OR "age" >= 0),
      ADD CONSTRAINT "CHK_resource_guide_people_employment_type"
        CHECK ("employment_type" IS NULL OR "employment_type" IN ('full_time', 'part_time'))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "resource_guide_people"
      DROP CONSTRAINT "CHK_resource_guide_people_employment_type",
      DROP CONSTRAINT "CHK_resource_guide_people_age",
      DROP COLUMN "remark",
      DROP COLUMN "has_labor_contract",
      DROP COLUMN "employment_type",
      DROP COLUMN "contact",
      DROP COLUMN "age"`);
  }
}
