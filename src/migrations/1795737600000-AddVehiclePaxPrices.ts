import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVehiclePaxPrices1795737600000 implements MigrationInterface {
  name = 'AddVehiclePaxPrices1795737600000';

  async up(q: QueryRunner): Promise<void> {
    // Additive adoption: no historical itinerary or frozen snapshot is repriced.
    await q.query(`
      ALTER TABLE itinerary_vehicle_plans ADD COLUMN quotation_mode text
        CHECK(quotation_mode IN ('itinerary','stage'));
      CREATE TABLE itinerary_vehicle_pax_prices(
        itinerary_id uuid NOT NULL, position integer NOT NULL CHECK(position>=0),
        tier text NOT NULL, pax integer NOT NULL CHECK(pax BETWEEN 1 AND 10000),
        total_price numeric CHECK(total_price>=0),
        pricing_mode text NOT NULL CHECK(pricing_mode IN ('automatic','manual')),
        segment_total numeric CHECK(segment_total>=0), adjustment_reason text NOT NULL DEFAULT '',
        PRIMARY KEY(itinerary_id,tier,pax), UNIQUE(itinerary_id,position),
        FOREIGN KEY(itinerary_id,tier) REFERENCES itinerary_vehicle_plans(itinerary_id,tier));
      CREATE TABLE itinerary_vehicle_range_pax_prices(
        itinerary_id uuid NOT NULL, position integer NOT NULL CHECK(position>=0),
        tier text NOT NULL, range_id text NOT NULL,
        pax integer NOT NULL CHECK(pax BETWEEN 1 AND 10000), total_price numeric CHECK(total_price>=0),
        PRIMARY KEY(itinerary_id,tier,range_id,pax), UNIQUE(itinerary_id,position),
        FOREIGN KEY(itinerary_id,tier,range_id) REFERENCES itinerary_vehicle_ranges(itinerary_id,tier,id),
        FOREIGN KEY(itinerary_id,tier,pax) REFERENCES itinerary_vehicle_pax_prices(itinerary_id,tier,pax));
      ALTER TABLE quote_pax_prices ADD COLUMN vehicle_total numeric CHECK(vehicle_total>=0);
      CREATE TABLE quote_vehicle_pax_prices(
        quote_id uuid NOT NULL REFERENCES itinerary_quotes(id), tier text NOT NULL,
        pax integer NOT NULL CHECK(pax BETWEEN 1 AND 10000),
        quotation_mode text NOT NULL CHECK(quotation_mode IN ('itinerary','stage')),
        total_price numeric CHECK(total_price>=0),
        pricing_mode text NOT NULL CHECK(pricing_mode IN ('automatic','manual')),
        segment_total numeric CHECK(segment_total>=0), adjustment_reason text NOT NULL,
        PRIMARY KEY(quote_id,tier,pax));
      CREATE TABLE quote_vehicle_range_pax_prices(
        quote_id uuid NOT NULL, tier text NOT NULL, range_id text NOT NULL,
        pax integer NOT NULL, total_price numeric CHECK(total_price>=0),
        PRIMARY KEY(quote_id,tier,range_id,pax),
        FOREIGN KEY(quote_id,tier,pax) REFERENCES quote_vehicle_pax_prices(quote_id,tier,pax),
        FOREIGN KEY(quote_id,tier,range_id) REFERENCES quote_vehicle_ranges(quote_id,tier,range_id));
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Vehicle PAX prices are retained. After adoption use a matching application; do not discard authored prices on rollback.',
      ),
    );
  }
}
