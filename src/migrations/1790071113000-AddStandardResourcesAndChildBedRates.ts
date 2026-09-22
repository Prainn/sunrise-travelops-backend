import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStandardResourcesAndChildBedRates1790071113000 implements MigrationInterface {
  name = 'AddStandardResourcesAndChildBedRates1790071113000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE resource_attractions ADD COLUMN is_standard_price boolean NOT NULL DEFAULT false;
      ALTER TABLE resource_restaurants ADD COLUMN is_standard_price boolean NOT NULL DEFAULT false;
      CREATE UNIQUE INDEX "UQ_resource_attractions_standard_city" ON resource_attractions(library,area) WHERE deleted_at IS NULL AND is_standard_price;
      CREATE UNIQUE INDEX "UQ_resource_restaurants_standard_city" ON resource_restaurants(library,city) WHERE deleted_at IS NULL AND is_standard_price;
      ALTER TABLE itineraries ADD COLUMN child_without_bed_rate double precision;
      UPDATE itineraries SET child_without_bed_rate=child_rate;
      ALTER TABLE itineraries ALTER COLUMN child_without_bed_rate SET NOT NULL,
        ALTER COLUMN child_without_bed_rate SET DEFAULT 90,
        ADD CONSTRAINT "CHK_itineraries_child_without_bed_rate" CHECK(child_without_bed_rate BETWEEN 0 AND 100);
      ALTER TABLE quote_pax_prices ADD COLUMN child_without_bed_unit_price numeric CHECK(child_without_bed_unit_price>=0);
    `);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Keep additive fields and recorded fares when rolling back the application.',
      ),
    );
  }
}
