import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebsiteAirportTransfers1796256014000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE website_legs
      ADD COLUMN is_airport_pickup boolean NOT NULL DEFAULT false,
      ADD COLUMN is_airport_dropoff boolean NOT NULL DEFAULT false`);
    await runner.query(`CREATE UNIQUE INDEX uq_website_legs_airport_pickup
      ON website_legs(day_id) WHERE is_airport_pickup`);
    await runner.query(`CREATE UNIQUE INDEX uq_website_legs_airport_dropoff
      ON website_legs(day_id) WHERE is_airport_dropoff`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM website_legs WHERE is_airport_pickup OR is_airport_dropoff) THEN
        RAISE EXCEPTION 'Website airport transfers are in use';
      END IF; END $$`);
    await runner.query(`ALTER TABLE website_legs
      DROP COLUMN is_airport_pickup, DROP COLUMN is_airport_dropoff`);
  }
}
