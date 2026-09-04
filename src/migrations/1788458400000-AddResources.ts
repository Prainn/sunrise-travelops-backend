import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddResources1788458400000 implements MigrationInterface {
  name = 'AddResources1788458400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "resource_agencies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "code" varchar(50) NOT NULL,
        "name" varchar(150) NOT NULL, "city" varchar(100) NOT NULL DEFAULT '',
        "country_or_region" varchar(100) NOT NULL DEFAULT '', "email" varchar(254) NOT NULL DEFAULT '',
        "status" varchar(20) NOT NULL DEFAULT 'enabled', "remark" text NOT NULL DEFAULT '',
        "version" integer NOT NULL DEFAULT 1, "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid, "updated_at" timestamptz NOT NULL DEFAULT now(), "updated_by" uuid,
        "deleted_at" timestamptz,
        CONSTRAINT "PK_resource_agencies" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_resource_agencies_code" UNIQUE ("code"),
        CONSTRAINT "CHK_resource_agencies_status" CHECK ("status" IN ('enabled', 'disabled'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_agencies_status" ON "resource_agencies" ("status") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE "resource_agency_contacts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "agency_id" uuid NOT NULL,
        "name" varchar(100) NOT NULL, "name_key" varchar(100) NOT NULL, "phone" varchar(50) NOT NULL DEFAULT '',
        "version" integer NOT NULL DEFAULT 1, "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid, "updated_at" timestamptz NOT NULL DEFAULT now(), "updated_by" uuid,
        "deleted_at" timestamptz,
        CONSTRAINT "PK_resource_agency_contacts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_resource_agency_contacts_agency" FOREIGN KEY ("agency_id") REFERENCES "resource_agencies"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_agency_contacts_agency" ON "resource_agency_contacts" ("agency_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_resource_agency_contacts_agency_name_key" ON "resource_agency_contacts" ("agency_id", "name_key") WHERE "deleted_at" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "resource_suppliers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "code" varchar(50) NOT NULL,
        "name" varchar(150) NOT NULL, "city" varchar(100) NOT NULL DEFAULT '',
        "country_or_region" varchar(100) NOT NULL DEFAULT '', "contact" varchar(100) NOT NULL DEFAULT '',
        "email" varchar(254) NOT NULL DEFAULT '', "phone" varchar(50) NOT NULL DEFAULT '',
        "status" varchar(20) NOT NULL DEFAULT 'enabled', "remark" text NOT NULL DEFAULT '',
        "version" integer NOT NULL DEFAULT 1, "created_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid, "updated_at" timestamptz NOT NULL DEFAULT now(), "updated_by" uuid,
        "deleted_at" timestamptz,
        CONSTRAINT "PK_resource_suppliers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_resource_suppliers_code" UNIQUE ("code"),
        CONSTRAINT "CHK_resource_suppliers_status" CHECK ("status" IN ('enabled', 'disabled'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_suppliers_status" ON "resource_suppliers" ("status") WHERE "deleted_at" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "resource_hotels" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "code" varchar(50) NOT NULL,
        "name" varchar(150) NOT NULL, "province" varchar(100) NOT NULL DEFAULT '', "city" varchar(100) NOT NULL DEFAULT '',
        "rating" varchar(50) NOT NULL DEFAULT '', "facilities" text NOT NULL DEFAULT '', "breakfast" text NOT NULL DEFAULT '',
        "address" varchar(500) NOT NULL DEFAULT '', "phone" varchar(50) NOT NULL DEFAULT '', "nearby" text NOT NULL DEFAULT '',
        "basic_room_type" varchar(100) NOT NULL, "individual_price" numeric(12,2) NOT NULL,
        "group_price" numeric(12,2), "minimum_group_size" integer, "unit" varchar(100) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'enabled', "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(), "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(), "updated_by" uuid, "deleted_at" timestamptz,
        CONSTRAINT "PK_resource_hotels" PRIMARY KEY ("id"), CONSTRAINT "UQ_resource_hotels_code" UNIQUE ("code"),
        CONSTRAINT "CHK_resource_hotels_status" CHECK ("status" IN ('enabled', 'disabled')),
        CONSTRAINT "CHK_resource_hotels_individual_price" CHECK ("individual_price" >= 0),
        CONSTRAINT "CHK_resource_hotels_group_price" CHECK ("group_price" IS NULL OR "group_price" >= 0),
        CONSTRAINT "CHK_resource_hotels_minimum_group_size" CHECK ("minimum_group_size" IS NULL OR "minimum_group_size" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_hotels_status_city_unit" ON "resource_hotels" ("status", "city", "unit") WHERE "deleted_at" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "resource_restaurants" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "code" varchar(50) NOT NULL, "name" varchar(150) NOT NULL,
        "city" varchar(100) NOT NULL DEFAULT '', "cuisine" varchar(100) NOT NULL DEFAULT '',
        "contact" varchar(100) NOT NULL DEFAULT '', "phone" varchar(50) NOT NULL DEFAULT '',
        "address" varchar(500) NOT NULL DEFAULT '', "remark" text NOT NULL DEFAULT '', "unit" varchar(100) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'enabled', "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(), "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(), "updated_by" uuid, "deleted_at" timestamptz,
        CONSTRAINT "PK_resource_restaurants" PRIMARY KEY ("id"), CONSTRAINT "UQ_resource_restaurants_code" UNIQUE ("code"),
        CONSTRAINT "CHK_resource_restaurants_status" CHECK ("status" IN ('enabled', 'disabled'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_restaurants_status_city_unit" ON "resource_restaurants" ("status", "city", "unit") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE "resource_restaurant_prices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "restaurant_id" uuid NOT NULL,
        "menu_name" varchar(150) NOT NULL, "dish_details" text NOT NULL DEFAULT '', "unit" varchar(100) NOT NULL,
        "price" numeric(12,2) NOT NULL, "diner_count" integer, "remark" text NOT NULL DEFAULT '',
        "is_ground_operator_provided" boolean NOT NULL DEFAULT false, "ground_operator_id" uuid,
        "version" integer NOT NULL DEFAULT 1, "created_at" timestamptz NOT NULL DEFAULT now(), "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(), "updated_by" uuid, "deleted_at" timestamptz,
        CONSTRAINT "PK_resource_restaurant_prices" PRIMARY KEY ("id"),
        CONSTRAINT "FK_resource_restaurant_prices_restaurant" FOREIGN KEY ("restaurant_id") REFERENCES "resource_restaurants"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_resource_restaurant_prices_supplier" FOREIGN KEY ("ground_operator_id") REFERENCES "resource_suppliers"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_resource_restaurant_prices_price" CHECK ("price" >= 0),
        CONSTRAINT "CHK_resource_restaurant_prices_diner_count" CHECK ("diner_count" IS NULL OR "diner_count" > 0),
        CONSTRAINT "CHK_resource_restaurant_prices_supplier" CHECK (("is_ground_operator_provided" = false AND "ground_operator_id" IS NULL) OR ("is_ground_operator_provided" = true AND "ground_operator_id" IS NOT NULL))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_restaurant_prices_restaurant" ON "resource_restaurant_prices" ("restaurant_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_restaurant_prices_supplier" ON "resource_restaurant_prices" ("ground_operator_id") WHERE "deleted_at" IS NULL AND "ground_operator_id" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "resource_attractions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "code" varchar(50) NOT NULL, "name" varchar(150) NOT NULL,
        "area" varchar(100) NOT NULL DEFAULT '', "category" varchar(20) NOT NULL,
        "restroom_location" varchar(500) NOT NULL DEFAULT '', "remark" text NOT NULL DEFAULT '', "unit" varchar(100) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'enabled', "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(), "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(), "updated_by" uuid, "deleted_at" timestamptz,
        CONSTRAINT "PK_resource_attractions" PRIMARY KEY ("id"), CONSTRAINT "UQ_resource_attractions_code" UNIQUE ("code"),
        CONSTRAINT "CHK_resource_attractions_status" CHECK ("status" IN ('enabled', 'disabled')),
        CONSTRAINT "CHK_resource_attractions_category" CHECK ("category" IN ('scenic', 'performance', 'experience', 'transport', 'package'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_attractions_status_area_category_unit" ON "resource_attractions" ("status", "area", "category", "unit") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE "resource_attraction_prices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "attraction_id" uuid NOT NULL,
        "item_type" varchar(20) NOT NULL, "item_name" varchar(150) NOT NULL,
        "audience" varchar(100) NOT NULL DEFAULT '', "period_name" varchar(100) NOT NULL DEFAULT '',
        "start_date" date, "end_date" date, "rack_price" numeric(12,2) NOT NULL, "settlement_price" numeric(12,2) NOT NULL,
        "unit" varchar(100) NOT NULL, "is_free" boolean NOT NULL DEFAULT false, "price_note" text NOT NULL DEFAULT '',
        "is_ground_operator_provided" boolean NOT NULL DEFAULT false, "ground_operator_id" uuid,
        "version" integer NOT NULL DEFAULT 1, "created_at" timestamptz NOT NULL DEFAULT now(), "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(), "updated_by" uuid, "deleted_at" timestamptz,
        CONSTRAINT "PK_resource_attraction_prices" PRIMARY KEY ("id"),
        CONSTRAINT "FK_resource_attraction_prices_attraction" FOREIGN KEY ("attraction_id") REFERENCES "resource_attractions"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_resource_attraction_prices_supplier" FOREIGN KEY ("ground_operator_id") REFERENCES "resource_suppliers"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_resource_attraction_prices_item_type" CHECK ("item_type" IN ('ticket', 'transport', 'guide', 'activity', 'package')),
        CONSTRAINT "CHK_resource_attraction_prices_dates" CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "start_date" <= "end_date"),
        CONSTRAINT "CHK_resource_attraction_prices_amounts" CHECK ("rack_price" >= 0 AND "settlement_price" >= 0),
        CONSTRAINT "CHK_resource_attraction_prices_free" CHECK ("is_free" = false OR ("rack_price" = 0 AND "settlement_price" = 0)),
        CONSTRAINT "CHK_resource_attraction_prices_supplier" CHECK (("is_ground_operator_provided" = false AND "ground_operator_id" IS NULL) OR ("is_ground_operator_provided" = true AND "ground_operator_id" IS NOT NULL))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_attraction_prices_attraction" ON "resource_attraction_prices" ("attraction_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_attraction_prices_supplier" ON "resource_attraction_prices" ("ground_operator_id") WHERE "deleted_at" IS NULL AND "ground_operator_id" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "resource_transports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "code" varchar(50) NOT NULL, "name" varchar(150) NOT NULL,
        "plate_number" varchar(50) NOT NULL DEFAULT '', "seats" integer NOT NULL, "daily_price" numeric(12,2) NOT NULL,
        "unit" varchar(100) NOT NULL, "city" varchar(100) NOT NULL DEFAULT '', "contact" varchar(100) NOT NULL DEFAULT '',
        "phone" varchar(50) NOT NULL DEFAULT '', "status" varchar(20) NOT NULL DEFAULT 'enabled', "remark" text NOT NULL DEFAULT '',
        "version" integer NOT NULL DEFAULT 1, "created_at" timestamptz NOT NULL DEFAULT now(), "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(), "updated_by" uuid, "deleted_at" timestamptz,
        CONSTRAINT "PK_resource_transports" PRIMARY KEY ("id"), CONSTRAINT "UQ_resource_transports_code" UNIQUE ("code"),
        CONSTRAINT "CHK_resource_transports_status" CHECK ("status" IN ('enabled', 'disabled')),
        CONSTRAINT "CHK_resource_transports_seats" CHECK ("seats" > 0),
        CONSTRAINT "CHK_resource_transports_daily_price" CHECK ("daily_price" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_transports_status_city_unit" ON "resource_transports" ("status", "city", "unit") WHERE "deleted_at" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "resource_guides" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "code" varchar(50) NOT NULL, "certificate_no" varchar(100) NOT NULL,
        "name" varchar(150) NOT NULL, "gender" varchar(10) NOT NULL, "age" integer NOT NULL, "languages" text[] NOT NULL,
        "employment_type" varchar(20) NOT NULL, "identity_number" varchar(100) NOT NULL, "phone" varchar(50) NOT NULL,
        "daily_price" numeric(12,2), "unit" varchar(100) NOT NULL, "has_labor_contract" boolean NOT NULL DEFAULT false,
        "is_ground_operator_provided" boolean NOT NULL DEFAULT false, "ground_operator_id" uuid,
        "license_photo_url" text NOT NULL DEFAULT '', "remark" text NOT NULL DEFAULT '', "status" varchar(20) NOT NULL DEFAULT 'enabled',
        "version" integer NOT NULL DEFAULT 1, "created_at" timestamptz NOT NULL DEFAULT now(), "created_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(), "updated_by" uuid, "deleted_at" timestamptz,
        CONSTRAINT "PK_resource_guides" PRIMARY KEY ("id"), CONSTRAINT "UQ_resource_guides_code" UNIQUE ("code"),
        CONSTRAINT "FK_resource_guides_supplier" FOREIGN KEY ("ground_operator_id") REFERENCES "resource_suppliers"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_resource_guides_status" CHECK ("status" IN ('enabled', 'disabled')),
        CONSTRAINT "CHK_resource_guides_gender" CHECK ("gender" IN ('male', 'female')),
        CONSTRAINT "CHK_resource_guides_employment_type" CHECK ("employment_type" IN ('full-time', 'part-time')),
        CONSTRAINT "CHK_resource_guides_age" CHECK ("age" > 0 AND "age" <= 130),
        CONSTRAINT "CHK_resource_guides_daily_price" CHECK ("daily_price" IS NULL OR "daily_price" >= 0),
        CONSTRAINT "CHK_resource_guides_supplier" CHECK (("is_ground_operator_provided" = false AND "ground_operator_id" IS NULL) OR ("is_ground_operator_provided" = true AND "ground_operator_id" IS NOT NULL))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_guides_filters" ON "resource_guides" ("status", "gender", "employment_type", "unit") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_resource_guides_supplier" ON "resource_guides" ("ground_operator_id") WHERE "deleted_at" IS NULL AND "ground_operator_id" IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "resource_guides"`);
    await queryRunner.query(`DROP TABLE "resource_transports"`);
    await queryRunner.query(`DROP TABLE "resource_attraction_prices"`);
    await queryRunner.query(`DROP TABLE "resource_attractions"`);
    await queryRunner.query(`DROP TABLE "resource_restaurant_prices"`);
    await queryRunner.query(`DROP TABLE "resource_restaurants"`);
    await queryRunner.query(`DROP TABLE "resource_hotels"`);
    await queryRunner.query(`DROP TABLE "resource_suppliers"`);
    await queryRunner.query(`DROP TABLE "resource_agency_contacts"`);
    await queryRunner.query(`DROP TABLE "resource_agencies"`);
  }
}
