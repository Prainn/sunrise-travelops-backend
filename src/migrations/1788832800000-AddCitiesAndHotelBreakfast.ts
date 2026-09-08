import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCitiesAndHotelBreakfast1788832800000 implements MigrationInterface {
  name = 'AddCitiesAndHotelBreakfast1788832800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "resource_cities" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "code" varchar(50) NOT NULL,
      "name" varchar(150) NOT NULL, "province" varchar(100) NOT NULL DEFAULT '',
      "status" varchar(20) NOT NULL DEFAULT 'enabled', "version" integer NOT NULL DEFAULT 1,
      "created_at" timestamptz NOT NULL DEFAULT now(), "created_by" uuid,
      "updated_at" timestamptz NOT NULL DEFAULT now(), "updated_by" uuid, "deleted_at" timestamptz,
      CONSTRAINT "UQ_resource_cities_code" UNIQUE ("code"),
      CONSTRAINT "UQ_resource_cities_name" UNIQUE ("name"),
      CONSTRAINT "CHK_resource_cities_status" CHECK ("status" IN ('enabled', 'disabled'))
    )`);
    await queryRunner.query(`INSERT INTO "resource_cities" ("code", "name", "province") VALUES
      ('CITY-001', '昆明', '云南省'), ('CITY-002', '大理', '云南省'),
      ('CITY-003', '丽江', '云南省'), ('CITY-004', '香格里拉', '云南省')`);
    const locations = [
      ['resource_agencies', 'city'],
      ['resource_suppliers', 'city'],
      ['resource_hotels', 'city'],
      ['resource_restaurants', 'city'],
      ['resource_transports', 'city'],
      ['resource_attractions', 'area'],
    ];
    for (const [table, field] of locations) {
      await queryRunner.query(`UPDATE "${table}" SET "${field}" = left("${field}", -1),
        "version" = "version" + 1, "updated_at" = now()
        WHERE "${field}" IN ('昆明市', '大理市', '丽江市', '香格里拉市')`);
    }
    const union = locations
      .map(
        ([table, field]) =>
          `SELECT "${field}" AS name FROM "${table}" WHERE "deleted_at" IS NULL`,
      )
      .join(' UNION ');
    await queryRunner.query(`INSERT INTO "resource_cities" ("code", "name")
      SELECT 'CITY-' || lpad((row_number() OVER (ORDER BY name) + 4)::text, 3, '0'), name
      FROM (${union}) existing WHERE name <> '' AND name NOT IN (SELECT name FROM "resource_cities")`);
    await queryRunner.query(
      `ALTER TABLE "resource_hotels" ADD "breakfast_included" boolean NOT NULL DEFAULT true`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resource_hotels" DROP COLUMN "breakfast_included"`,
    );
    await queryRunner.query(`DROP TABLE "resource_cities"`);
  }
}
