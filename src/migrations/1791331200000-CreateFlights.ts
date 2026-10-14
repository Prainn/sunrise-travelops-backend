import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFlights1791331200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "resource_flights" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "library" text NOT NULL REFERENCES "resource_libraries"("code"),
      "departure_city" varchar(150) NOT NULL,
      "arrival_city" varchar(150) NOT NULL,
      "flight_number" varchar(20) NOT NULL,
      "departure_time" varchar(5) NOT NULL,
      "arrival_time" varchar(5) NOT NULL,
      "status" varchar(20) NOT NULL DEFAULT 'enabled',
      "version" integer NOT NULL DEFAULT 1,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "created_by" uuid,
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "updated_by" uuid,
      "deleted_at" timestamptz,
      CONSTRAINT "PK_resource_flights" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_resource_flights_cities" CHECK (length(btrim("departure_city")) > 0 AND length(btrim("arrival_city")) > 0),
      CONSTRAINT "CHK_resource_flights_number" CHECK ("flight_number" ~ '^[A-Z0-9]{1,20}$'),
      CONSTRAINT "CHK_resource_flights_times" CHECK (
        "departure_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
        "arrival_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
      CONSTRAINT "CHK_resource_flights_status" CHECK ("status" IN ('enabled','disabled'))
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_resource_flights_library_status"
      ON "resource_flights" ("library", "status") WHERE "deleted_at" IS NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_resource_flights_schedule"
      ON "resource_flights" ("library", "departure_city", "arrival_city", "flight_number", "departure_time", "arrival_time")
      WHERE "deleted_at" IS NULL`);

    const definitions = [
      ['resource:flight:list', '查看航班信息'],
      ['resource:flight:create', '新增航班信息'],
      ['resource:flight:update', '修改航班信息'],
      ['resource:flight:delete', '删除航班信息'],
    ];
    for (const [code, name] of definitions) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("code", "name") VALUES ($1,$2) ON CONFLICT ("code") DO NOTHING`,
        [code, name],
      );
      const roles = ['ROOT', 'ADMIN', 'BUSINESS_MANAGER', 'RESOURCE_MANAGER'];
      if (code.endsWith(':list')) roles.push('EXECUTIVE', 'COORDINATOR');
      await queryRunner.query(
        `INSERT INTO "role_permissions" ("role_id", "permission_id")
         SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
         WHERE r."code" = ANY($1::text[]) AND p."code" = $2
         ON CONFLICT DO NOTHING`,
        [roles, code],
      );
    }
  }

  down(): Promise<void> {
    throw new Error(
      'Restore a pre-migration backup to remove flight data safely',
    );
  }
}
