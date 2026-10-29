import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebsiteQuotationHotelTiers1794873600000 implements MigrationInterface {
  name = 'WebsiteQuotationHotelTiers1794873600000';

  async up(q: QueryRunner): Promise<void> {
    // Old A/B prices and components remain a read-only archive. There is no
    // reliable association to hotel tiers, so never fabricate a conversion.
    // Frozen quotation JSON and itinerary versions are deliberately untouched.
    await q.query(`CREATE TABLE website_quotation_prices (
      itinerary_id uuid NOT NULL REFERENCES website_itineraries(id) ON DELETE CASCADE,
      vehicle_type text NOT NULL CHECK (vehicle_type='' OR (vehicle_type=btrim(vehicle_type) AND length(vehicle_type) BETWEEN 1 AND 100)),
      hotel_tier text NOT NULL CHECK (hotel_tier IN ('','A','B','C','D')),
      unit_price numeric(12,2) CHECK (unit_price >= 0),
      PRIMARY KEY (itinerary_id,vehicle_type,hotel_tier)
    )`);
    // Empty dimension keys represent explicit API null, not an inferred option.
    await q.query(`CREATE TABLE website_quotation_price_components (
      itinerary_id uuid NOT NULL,
      vehicle_type text NOT NULL,
      hotel_tier text NOT NULL,
      category text NOT NULL CHECK (category IN ('hotel','guide','vehicle','attraction','meal')),
      unit_price numeric(12,2) CHECK (unit_price >= 0),
      show_in_pdf boolean NOT NULL,
      PRIMARY KEY (itinerary_id,vehicle_type,hotel_tier,category),
      FOREIGN KEY (itinerary_id,vehicle_type,hotel_tier)
        REFERENCES website_quotation_prices(itinerary_id,vehicle_type,hotel_tier) ON DELETE CASCADE
    )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM website_quotation_prices)
        OR EXISTS (SELECT 1 FROM website_quotations WHERE (snapshot->>'schemaVersion')::integer >= 5)
      THEN RAISE EXCEPTION 'Hotel-tier quotation data prevents rollback'; END IF;
    END $$`);
    await q.query('DROP TABLE website_quotation_price_components');
    await q.query('DROP TABLE website_quotation_prices');
  }
}
