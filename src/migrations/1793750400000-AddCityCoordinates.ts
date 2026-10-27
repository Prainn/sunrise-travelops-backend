import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCityCoordinates1793750400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE resource_cities
      ADD COLUMN longitude double precision,
      ADD COLUMN latitude double precision,
      ADD CONSTRAINT "CHK_resource_cities_coordinates" CHECK (
        (longitude IS NULL AND latitude IS NULL) OR
        (longitude IS NOT NULL AND latitude IS NOT NULL
          AND longitude BETWEEN -180 AND 180 AND latitude BETWEEN -90 AND 90)
      )`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE resource_cities
      DROP CONSTRAINT "CHK_resource_cities_coordinates",
      DROP COLUMN longitude, DROP COLUMN latitude`);
  }
}
