import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WebsiteNightlyHotelPricing1796256015000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE website_itineraries
      ADD COLUMN hotel_pricing_mode text NOT NULL DEFAULT 'tiered' CHECK (hotel_pricing_mode IN ('tiered','nightly')),
      ADD COLUMN nightly_show_hotel_price boolean NOT NULL DEFAULT false`);
    await runner.query(`ALTER TABLE website_hotels
      ADD COLUMN nightly_only boolean NOT NULL DEFAULT false,
      ADD COLUMN nightly_selected boolean,
      ADD COLUMN nightly_rooms integer CHECK (nightly_rooms BETWEEN 1 AND 10000),
      ADD COLUMN nightly_rate numeric(12,2) CHECK (nightly_rate >= 0),
      DROP CONSTRAINT website_hotels_day_id_tier_key`);
    await runner.query(
      `CREATE UNIQUE INDEX uq_website_tiered_hotel ON website_hotels(day_id,tier) WHERE NOT nightly_only`,
    );
    await runner.query(`CREATE TABLE website_nightly_price_components (
      itinerary_id uuid NOT NULL REFERENCES website_itineraries(id) ON DELETE CASCADE,
      vehicle_type text NOT NULL CHECK (length(vehicle_type) <= 100 AND vehicle_type=btrim(vehicle_type)),
      category text NOT NULL CHECK (category IN ('guide','vehicle','attraction','meal')),
      unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
      show_in_pdf boolean NOT NULL,
      PRIMARY KEY (itinerary_id,vehicle_type,category)
    )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN
      IF EXISTS (SELECT FROM website_itineraries WHERE hotel_pricing_mode='nightly' OR nightly_show_hotel_price)
        OR EXISTS (SELECT FROM website_hotels WHERE nightly_only OR nightly_selected IS NOT NULL OR nightly_rooms IS NOT NULL OR nightly_rate IS NOT NULL)
        OR EXISTS (SELECT FROM website_nightly_price_components)
        OR EXISTS (SELECT FROM website_quotations WHERE snapshot->'english'->>'hotelPricingMode'='nightly')
      THEN RAISE EXCEPTION 'Nightly hotel quotations are in use'; END IF;
    END $$`);
    await runner.query('DROP TABLE website_nightly_price_components');
    await runner.query('DROP INDEX uq_website_tiered_hotel');
    await runner.query(`ALTER TABLE website_hotels ADD UNIQUE (day_id,tier),
      DROP COLUMN nightly_only, DROP COLUMN nightly_selected, DROP COLUMN nightly_rooms, DROP COLUMN nightly_rate`);
    await runner.query(
      'ALTER TABLE website_itineraries DROP COLUMN hotel_pricing_mode, DROP COLUMN nightly_show_hotel_price',
    );
  }
}
