import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSystemDictionaries1788285600000 implements MigrationInterface {
  name = 'AddSystemDictionaries1788285600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "system_dictionary_types" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(100) NOT NULL,
        "dict_code" varchar(100) NOT NULL,
        "status" smallint NOT NULL DEFAULT 1,
        "remark" text,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        "deleted_at" timestamptz,
        CONSTRAINT "PK_system_dictionary_types" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_system_dictionary_types_dict_code" UNIQUE ("dict_code"),
        CONSTRAINT "CHK_system_dictionary_types_status" CHECK ("status" IN (0, 1))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_system_dictionary_types_status" ON "system_dictionary_types" ("status") WHERE "deleted_at" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "system_dictionary_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "type_id" uuid NOT NULL,
        "label" varchar(100) NOT NULL,
        "value" varchar(100) NOT NULL,
        "status" smallint NOT NULL DEFAULT 1,
        "sort" integer NOT NULL DEFAULT 1,
        "tag_type" varchar(20) NOT NULL DEFAULT '',
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        "deleted_at" timestamptz,
        CONSTRAINT "PK_system_dictionary_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_system_dictionary_items_type_value" UNIQUE ("type_id", "value"),
        CONSTRAINT "CHK_system_dictionary_items_status" CHECK ("status" IN (0, 1)),
        CONSTRAINT "CHK_system_dictionary_items_tag_type" CHECK ("tag_type" IN ('', 'primary', 'success', 'info', 'warning', 'danger')),
        CONSTRAINT "FK_system_dictionary_items_type" FOREIGN KEY ("type_id") REFERENCES "system_dictionary_types"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_system_dictionary_items_type_status_sort" ON "system_dictionary_items" ("type_id", "status", "sort") WHERE "deleted_at" IS NULL`,
    );

    await queryRunner.query(`
      INSERT INTO "system_dictionary_types" ("id", "name", "dict_code", "status", "remark") VALUES
        ('00000000-0000-4000-8000-000000000001', '用户性别', 'gender', 1, '用户资料中的性别选项'),
        ('00000000-0000-4000-8000-000000000002', '启用状态', 'common_status', 1, '系统数据通用的启用与禁用状态'),
        ('00000000-0000-4000-8000-000000000003', '是否选项', 'yes_no', 1, '系统表单通用的是与否选项')
    `);
    await queryRunner.query(`
      INSERT INTO "system_dictionary_items" ("id", "type_id", "label", "value", "status", "sort", "tag_type") VALUES
        ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', '男', '1', 1, 1, 'primary'),
        ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', '女', '2', 1, 2, 'danger'),
        ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', '未设置', '0', 1, 3, 'info'),
        ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000002', '启用', '1', 1, 1, 'success'),
        ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000002', '禁用', '0', 1, 2, 'info'),
        ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000003', '是', '1', 1, 1, 'success'),
        ('00000000-0000-4000-8000-000000000107', '00000000-0000-4000-8000-000000000003', '否', '0', 1, 2, 'info')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "system_dictionary_items"`);
    await queryRunner.query(`DROP TABLE "system_dictionary_types"`);
  }
}
