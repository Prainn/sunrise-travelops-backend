import { MigrationInterface, QueryRunner } from 'typeorm';

export class AssignVehiclesByPax1796256023000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Keep the original order and snapshots of every vehicle within each PAX tier.
    await q.query(`
      ALTER TABLE itinerary_vehicles
        DROP CONSTRAINT itinerary_vehicles_itinerary_id_tier_range_id_vehicle_id_key,
        ADD COLUMN pax integer;
      UPDATE itinerary_vehicles AS v SET pax = i.pax_tiers[1]
        FROM itineraries AS i WHERE i.id = v.itinerary_id;
      WITH additional AS (
        SELECT v.*, p.pax AS new_pax,
          row_number() OVER (PARTITION BY v.itinerary_id ORDER BY p.ordinal, v.position) AS offset_position
        FROM itinerary_vehicles v JOIN itineraries i ON i.id = v.itinerary_id
        CROSS JOIN LATERAL unnest(i.pax_tiers) WITH ORDINALITY AS p(pax, ordinal)
        WHERE p.ordinal > 1
      ), last_positions AS (
        SELECT itinerary_id, max(position) AS last_position FROM itinerary_vehicles GROUP BY itinerary_id
      )
      INSERT INTO itinerary_vehicles(itinerary_id, position, tier, range_id, pax, vehicle_id, vehicle_name, seats, quantity)
        SELECT a.itinerary_id, l.last_position + a.offset_position, a.tier, a.range_id,
          a.new_pax, a.vehicle_id, a.vehicle_name, a.seats, a.quantity
        FROM additional a JOIN last_positions l USING (itinerary_id);
      ALTER TABLE itinerary_vehicles
        ALTER COLUMN pax SET NOT NULL,
        ADD UNIQUE (itinerary_id, tier, range_id, pax, vehicle_id),
        ADD FOREIGN KEY (itinerary_id, tier, range_id, pax)
          REFERENCES itinerary_vehicle_range_pax_prices(itinerary_id, tier, range_id, pax);
      ALTER TABLE quote_vehicles
        ADD COLUMN pax integer CHECK (pax BETWEEN 1 AND 10000),
        ADD UNIQUE (quote_id, tier, range_id, pax, vehicle_id),
        ADD FOREIGN KEY (quote_id, tier, range_id, pax)
          REFERENCES quote_vehicle_range_pax_prices(quote_id, tier, range_id, pax)
          DEFERRABLE INITIALLY DEFERRED;
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Per-PAX vehicle assignments cannot be merged into a shared fleet without losing data.',
      ),
    );
  }
}
