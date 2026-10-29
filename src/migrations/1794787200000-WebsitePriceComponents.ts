import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebsitePriceComponents1794787200000 implements MigrationInterface {
  name = 'WebsitePriceComponents1794787200000';

  async up(q: QueryRunner): Promise<void> {
    // Historical totals and frozen snapshots have no reliable allocation: leave them intact.
    await q.query(`CREATE TABLE website_price_components (
      itinerary_id uuid NOT NULL,
      vehicle_type text NOT NULL,
      plan text NOT NULL,
      category text NOT NULL CHECK (category IN ('hotel','guide','vehicle','attraction','meal')),
      unit_price numeric(12,2) CHECK (unit_price >= 0),
      show_in_pdf boolean NOT NULL DEFAULT false,
      PRIMARY KEY (itinerary_id,vehicle_type,plan,category),
      FOREIGN KEY (itinerary_id,vehicle_type,plan)
        REFERENCES website_vehicle_prices(itinerary_id,vehicle_type,plan) ON DELETE CASCADE
    )`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM website_price_components)
      THEN RAISE EXCEPTION 'Authored price components prevent rollback'; END IF;
    END $$`);
    await q.query('DROP TABLE website_price_components');
  }
}
