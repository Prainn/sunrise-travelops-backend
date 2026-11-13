import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retires verified-empty legacy quote storage and the A/B website plan prices.
 * Pre-checks fail the migration instead of discarding values written after the audit.
 */
export class RetireLegacyQuoteData1796256005000 implements MigrationInterface {
  name = 'RetireLegacyQuoteData1796256005000';

  async up(r: QueryRunner): Promise<void> {
    await r.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM quote_options WHERE hotel_cost IS NOT NULL OR vehicle_cost IS NOT NULL
          OR common_group_cost IS NOT NULL OR base_group_cost IS NOT NULL OR base_cost_per_person IS NOT NULL
          OR single_supplement_unit_cost IS NOT NULL OR adult_unit_price IS NOT NULL OR child_unit_price IS NOT NULL
          OR total_price IS NOT NULL OR expected_profit IS NOT NULL OR margin_rate IS NOT NULL OR leader_foc_enabled IS NOT NULL)
        OR EXISTS (SELECT 1 FROM itinerary_quotes WHERE hotel_guest_count IS NOT NULL OR hotel_room_count IS NOT NULL)
        OR EXISTS (SELECT 1 FROM quote_lines) THEN
        RAISE EXCEPTION 'Legacy quote columns hold data; review before retiring them';
      END IF;
      IF EXISTS (SELECT 1 FROM resource_attractions WHERE price IS NULL)
        OR EXISTS (SELECT 1 FROM resource_restaurants WHERE price IS NULL) THEN
        RAISE EXCEPTION 'Attraction or restaurant prices are missing; price them before requiring prices';
      END IF;
      IF EXISTS (SELECT 1 FROM website_quotations WHERE (snapshot->>'schemaVersion')::integer < 6) THEN
        RAISE EXCEPTION 'Website quotations older than schema 6 remain; clean them before retiring their renderers';
      END IF;
    END $$`);
    await r.query(`
      DROP TABLE quote_lines;
      ALTER TABLE quote_options DROP COLUMN hotel_cost, DROP COLUMN vehicle_cost,
        DROP COLUMN common_group_cost, DROP COLUMN base_group_cost, DROP COLUMN base_cost_per_person,
        DROP COLUMN single_supplement_unit_cost, DROP COLUMN adult_unit_price, DROP COLUMN child_unit_price,
        DROP COLUMN total_price, DROP COLUMN expected_profit, DROP COLUMN margin_rate,
        DROP COLUMN leader_foc_enabled;
      ALTER TABLE itinerary_quotes DROP COLUMN hotel_guest_count, DROP COLUMN hotel_room_count;
      DROP TABLE website_price_components;
      DROP TABLE website_vehicle_prices;
      ALTER TABLE resource_attractions ALTER COLUMN price SET NOT NULL,
        DROP CONSTRAINT "CHK_resource_attractions_price",
        ADD CONSTRAINT "CHK_resource_attractions_price" CHECK (price >= 0);
      ALTER TABLE resource_restaurants ALTER COLUMN price SET NOT NULL,
        DROP CONSTRAINT "CHK_resource_restaurants_price",
        ADD CONSTRAINT "CHK_resource_restaurants_price" CHECK (price >= 0);
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Retired legacy quote storage is not recreated. Restore from the pre-release table backups if needed.',
      ),
    );
  }
}
