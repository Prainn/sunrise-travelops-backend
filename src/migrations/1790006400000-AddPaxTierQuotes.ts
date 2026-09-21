import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaxTierQuotes1790006400000 implements MigrationInterface {
  name = 'AddPaxTierQuotes1790006400000';

  async up(q: QueryRunner): Promise<void> {
    // Freeze snapshots and their old structured quote lines remain unchanged.
    await q.query(`
      ALTER TABLE itineraries ADD COLUMN pax_tiers integer[], ADD COLUMN child_rate double precision NOT NULL DEFAULT 70;
      UPDATE itineraries SET pax_tiers=ARRAY[GREATEST(adults+children_count,1)];
      ALTER TABLE itineraries ALTER COLUMN pax_tiers SET NOT NULL,
        ADD CHECK(cardinality(pax_tiers) BETWEEN 1 AND 20 AND 0 < ALL(pax_tiers) AND 10000 >= ALL(pax_tiers)),
        ADD CHECK(child_rate BETWEEN 0 AND 100),
        ALTER COLUMN adults SET DEFAULT 1, ALTER COLUMN children_count SET DEFAULT 0, ALTER COLUMN leader_count SET DEFAULT 0;
      ALTER TABLE itinerary_items ADD COLUMN diner_count integer CHECK(diner_count>0);
      UPDATE itinerary_items i SET diner_count=p.diner_count FROM resource_restaurant_prices p WHERE i.resource_price_id=p.id AND i.unit='table';
      UPDATE itinerary_items i SET quantity=CASE WHEN i.unit='table' THEN 1 ELSE i.quantity/GREATEST(t.adults+t.children_count,1) END
        FROM itineraries t WHERE i.itinerary_id=t.id;
      UPDATE itinerary_items SET total_cost=CASE WHEN unit='table' AND diner_count IS NOT NULL THEN round(round(unit_cost/diner_count,2)*quantity,2)
        WHEN unit<>'table' THEN round(unit_cost*quantity,2) ELSE total_cost END;
      ALTER TABLE itinerary_quote_options ADD COLUMN guide_service_total numeric CHECK(guide_service_total>=0),
        ADD COLUMN staff_room_total numeric CHECK(staff_room_total>=0), ALTER COLUMN leader_foc_enabled SET DEFAULT false;
      UPDATE itinerary_quote_options o SET guide_service_total=s.other_expenses+COALESCE((SELECT sum(g.daily_price*g.service_days) FROM itinerary_guides g WHERE g.itinerary_id=o.itinerary_id),0)
        FROM itinerary_quote_settings s WHERE s.itinerary_id=o.itinerary_id AND s.other_expenses IS NOT NULL;
      CREATE TABLE itinerary_pax_prices(
        itinerary_id uuid NOT NULL, position integer NOT NULL CHECK(position>=0), option_id text NOT NULL,
        pax integer NOT NULL CHECK(pax BETWEEN 1 AND 10000), adult_unit_price numeric CHECK(adult_unit_price>=0),
        PRIMARY KEY(itinerary_id,position), UNIQUE(itinerary_id,option_id,pax),
        FOREIGN KEY(itinerary_id,option_id) REFERENCES itinerary_quote_options(itinerary_id,id));
      INSERT INTO itinerary_pax_prices(itinerary_id,position,option_id,pax,adult_unit_price)
        SELECT o.itinerary_id,o.position,o.id,t.pax_tiers[1],o.adult_unit_price FROM itinerary_quote_options o JOIN itineraries t ON t.id=o.itinerary_id;
      ALTER TABLE itinerary_quotes ALTER COLUMN hotel_guest_count DROP NOT NULL, ALTER COLUMN hotel_room_count DROP NOT NULL;
      ALTER TABLE quote_resource_lines ADD COLUMN diner_count integer CHECK(diner_count>0);
      ALTER TABLE quote_options ADD COLUMN hotel_unit_cost numeric, ADD COLUMN vehicle_total numeric,
        ADD COLUMN guide_service_total numeric, ADD COLUMN staff_room_total numeric;
      CREATE TABLE quote_pax_prices(
        quote_id uuid NOT NULL, option_id text NOT NULL, position integer NOT NULL,
        pax integer NOT NULL CHECK(pax BETWEEN 1 AND 10000),
        vehicle_unit_cost numeric NOT NULL, guide_service_unit_cost numeric NOT NULL, staff_room_unit_cost numeric NOT NULL,
        base_cost_per_person numeric NOT NULL, adult_unit_price numeric NOT NULL, child_unit_price numeric NOT NULL,
        leader_unit_price numeric NOT NULL, single_supplement_unit_cost numeric NOT NULL, tip_unit_price numeric NOT NULL,
        profit_per_person numeric NOT NULL, actual_margin_rate double precision,
        PRIMARY KEY(quote_id,option_id,pax), UNIQUE(quote_id,option_id,position),
        FOREIGN KEY(quote_id,option_id) REFERENCES quote_options(quote_id,option_id));
    `);
    for (const column of [
      'hotel_cost',
      'vehicle_cost',
      'common_group_cost',
      'base_group_cost',
      'base_cost_per_person',
      'single_supplement_unit_cost',
      'adult_unit_price',
      'child_unit_price',
      'total_price',
      'expected_profit',
      'margin_rate',
      'leader_foc_enabled',
    ]) {
      await q.query(
        `ALTER TABLE quote_options ALTER COLUMN ${column} DROP NOT NULL`,
      );
    }
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'PAX pricing changes itinerary quantity semantics; restore a pre-migration backup with its matching application.',
      ),
    );
  }
}
