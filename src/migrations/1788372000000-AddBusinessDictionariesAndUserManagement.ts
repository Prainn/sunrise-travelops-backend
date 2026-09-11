import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessDictionariesAndUserManagement1788372000000 implements MigrationInterface {
  name = 'AddBusinessDictionariesAndUserManagement1788372000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "version" integer NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "deleted_at" timestamptz`);
    await queryRunner.query(
      `CREATE INDEX "IDX_users_status" ON "users" ("status") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`
      UPDATE "permissions"
      SET "code" = replace("code", 'sys:business-category:', 'sys:business-dictionary:')
      WHERE "code" LIKE 'sys:business-category:%'
    `);

    await queryRunner.query(`
      CREATE TABLE "system_business_dictionary_types" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(100) NOT NULL,
        "english_name" varchar(150) NOT NULL,
        "code" varchar(100) NOT NULL,
        "is_built_in" boolean NOT NULL DEFAULT false,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        "deleted_at" timestamptz,
        CONSTRAINT "PK_system_business_dictionary_types" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_system_business_dictionary_types_code" UNIQUE ("code")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_system_business_dictionary_types_deleted_at" ON "system_business_dictionary_types" ("deleted_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "system_business_dictionary_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "type_id" uuid NOT NULL,
        "code" varchar(100) NOT NULL,
        "name" varchar(100) NOT NULL,
        "english_name" varchar(150) NOT NULL,
        "resource_types" text[] NOT NULL DEFAULT '{}',
        "status" varchar(20) NOT NULL DEFAULT 'enabled',
        "remark" text NOT NULL DEFAULT '',
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        "deleted_at" timestamptz,
        CONSTRAINT "PK_system_business_dictionary_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_system_business_dictionary_items_type_code" UNIQUE ("type_id", "code"),
        CONSTRAINT "CHK_system_business_dictionary_items_status" CHECK ("status" IN ('enabled', 'disabled')),
        CONSTRAINT "FK_system_business_dictionary_items_type" FOREIGN KEY ("type_id") REFERENCES "system_business_dictionary_types"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_system_business_dictionary_items_type_status" ON "system_business_dictionary_items" ("type_id", "status") WHERE "deleted_at" IS NULL`,
    );

    await queryRunner.query(`
      INSERT INTO "system_business_dictionary_types" ("id", "name", "english_name", "code", "is_built_in") VALUES
        ('10000000-0000-4000-8000-000000000001', '资源计价单位', 'Resource Price Units', 'resource-unit', true),
        ('10000000-0000-4000-8000-000000000002', '交通方式', 'Transport Methods', 'transport-method', true)
    `);
    await queryRunner.query(`
      INSERT INTO "system_business_dictionary_items" ("id", "type_id", "code", "name", "english_name", "resource_types", "status", "remark") VALUES
        ('10000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000001', 'roomNight', '间夜', 'Room night', ARRAY['hotel'], 'enabled', '酒店房型按间夜计价'),
        ('10000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000001', 'personVisit', '人次', 'Person visit', ARRAY['attraction'], 'enabled', '景点门票及景区项目按使用人次计价'),
        ('10000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000001', 'personMeal', '人/餐', 'Person/meal', ARRAY['restaurant'], 'enabled', '餐厅按每人每餐计价'),
        ('10000000-0000-4000-8000-000000000104', '10000000-0000-4000-8000-000000000001', 'table', '桌', 'Table', ARRAY['restaurant'], 'enabled', '餐厅整桌报价'),
        ('10000000-0000-4000-8000-000000000105', '10000000-0000-4000-8000-000000000001', 'vehicleDay', '辆/天', 'Vehicle/day', ARRAY['vehicle'], 'enabled', '车辆按每辆每天计价'),
        ('10000000-0000-4000-8000-000000000106', '10000000-0000-4000-8000-000000000001', 'guideDay', '人/天', 'Person/day', ARRAY['guide'], 'enabled', '导游按每人每天计价'),
        ('10000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000002', 'flight', '飞机', 'Flight', '{}', 'enabled', '航空交通'),
        ('10000000-0000-4000-8000-000000000202', '10000000-0000-4000-8000-000000000002', 'businessCar', '商务车', 'Business car', '{}', 'enabled', '小型团队包车'),
        ('10000000-0000-4000-8000-000000000203', '10000000-0000-4000-8000-000000000002', 'highSpeedRail', '动车', 'High-speed rail', '{}', 'enabled', '动车或高铁'),
        ('10000000-0000-4000-8000-000000000204', '10000000-0000-4000-8000-000000000002', 'coach', '巴士', 'Coach', '{}', 'enabled', '大型团队包车'),
        ('10000000-0000-4000-8000-000000000205', '10000000-0000-4000-8000-000000000002', 'ship', '船', 'Ship', '{}', 'enabled', '水路交通'),
        ('10000000-0000-4000-8000-000000000206', '10000000-0000-4000-8000-000000000002', 'walking', '步行', 'Walking', '{}', 'enabled', '徒步或步行游览')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "system_business_dictionary_items"`);
    await queryRunner.query(`DROP TABLE "system_business_dictionary_types"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_status"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deleted_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "version"`);
    await queryRunner.query(`
      UPDATE "permissions"
      SET "code" = replace("code", 'sys:business-dictionary:', 'sys:business-category:')
      WHERE "code" LIKE 'sys:business-dictionary:%'
    `);
  }
}
