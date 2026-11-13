import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Converts shared-price vehicle plans to PAX-tier plans, matching the editor's adoption rule:
 * an itinerary with any vehicle detail uses itinerary mode, otherwise stage mode; every PAX tier
 * receives the old shared total and every range PAX tier the old range total. Prices are copied,
 * never recalculated; a stored total that disagrees with its automatic rule stops the migration.
 */
export class RequireVehicleQuotationMode1796256006000 implements MigrationInterface {
  name = 'RequireVehicleQuotationMode1796256006000';

  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TEMP TABLE legacy_vehicle_plans ON COMMIT DROP AS
      SELECT p.itinerary_id, p.tier, p.position, t.pax_tiers,
        CASE WHEN EXISTS (SELECT 1 FROM itinerary_vehicles v WHERE v.itinerary_id=p.itinerary_id)
          THEN 'itinerary' ELSE 'stage' END AS mode,
        p.total_price, p.pricing_mode, COALESCE(p.adjustment_reason,'') AS adjustment_reason,
        (SELECT count(*) FROM itinerary_vehicle_ranges g WHERE g.itinerary_id=p.itinerary_id AND g.tier=p.tier) AS ranges,
        (SELECT CASE WHEN count(*)=0 OR bool_or(g.total_price IS NULL) THEN NULL ELSE sum(g.total_price) END
          FROM itinerary_vehicle_ranges g WHERE g.itinerary_id=p.itinerary_id AND g.tier=p.tier) AS segment_total
      FROM itinerary_vehicle_plans p JOIN itineraries t ON t.id=p.itinerary_id
      WHERE p.quotation_mode IS NULL`);
    await r.query(`
      ALTER TABLE legacy_vehicle_plans ADD COLUMN pricing text;
      UPDATE legacy_vehicle_plans SET pricing=CASE
        WHEN mode='stage' OR ranges=0 OR pricing_mode='automatic' THEN 'automatic' ELSE 'manual' END`);
    await r.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM itinerary_vehicle_plans p JOIN legacy_vehicle_plans l USING (itinerary_id)
          WHERE p.quotation_mode IS NOT NULL) THEN
        RAISE EXCEPTION 'An itinerary mixes legacy and PAX-tier vehicle plans';
      END IF;
      IF EXISTS (SELECT 1 FROM itinerary_vehicle_pax_prices x JOIN legacy_vehicle_plans l USING (itinerary_id, tier)) THEN
        RAISE EXCEPTION 'A legacy vehicle plan already has PAX-tier prices';
      END IF;
      IF EXISTS (SELECT 1 FROM legacy_vehicle_plans WHERE pricing='automatic' AND ranges>0
          AND total_price IS DISTINCT FROM segment_total) THEN
        RAISE EXCEPTION 'A legacy automatic vehicle total differs from its range total';
      END IF;
    END $$`);
    await r.query(`
      INSERT INTO itinerary_vehicle_pax_prices(itinerary_id,position,tier,pax,total_price,pricing_mode,segment_total,adjustment_reason)
      SELECT l.itinerary_id,
        row_number() OVER (PARTITION BY l.itinerary_id ORDER BY l.position, x.pax) - 1,
        l.tier, x.pax,
        CASE WHEN l.ranges=0 THEN NULL WHEN l.pricing='automatic' THEN l.segment_total ELSE l.total_price END,
        l.pricing, l.segment_total,
        CASE WHEN l.pricing='manual' THEN l.adjustment_reason ELSE '' END
      FROM legacy_vehicle_plans l CROSS JOIN LATERAL unnest(l.pax_tiers) AS x(pax)`);
    await r.query(`
      INSERT INTO itinerary_vehicle_range_pax_prices(itinerary_id,position,tier,range_id,pax,total_price)
      SELECT g.itinerary_id,
        row_number() OVER (PARTITION BY g.itinerary_id ORDER BY l.position, g.position, x.pax) - 1,
        g.tier, g.id, x.pax, g.total_price
      FROM legacy_vehicle_plans l
      JOIN itinerary_vehicle_ranges g ON g.itinerary_id=l.itinerary_id AND g.tier=l.tier
      CROSS JOIN LATERAL unnest(l.pax_tiers) AS x(pax)`);
    await r.query(`
      UPDATE itinerary_vehicle_ranges g SET total_price=NULL FROM legacy_vehicle_plans l
        WHERE g.itinerary_id=l.itinerary_id AND g.tier=l.tier;
      UPDATE itinerary_vehicle_plans p SET quotation_mode=l.mode, total_price=NULL, pricing_mode=NULL,
        segment_total=NULL, adjustment_reason='' FROM legacy_vehicle_plans l
        WHERE p.itinerary_id=l.itinerary_id AND p.tier=l.tier;
      ALTER TABLE itinerary_vehicle_plans ALTER COLUMN quotation_mode SET NOT NULL`);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query(
      'ALTER TABLE itinerary_vehicle_plans ALTER COLUMN quotation_mode DROP NOT NULL',
    );
  }
}
