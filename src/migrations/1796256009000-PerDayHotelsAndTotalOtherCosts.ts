import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Standard itinerary hotels move from one hotel per tier and city to one per tier and
 * overnight day: each city selection is copied to every active day overnighting there,
 * so existing totals stay unchanged. A selection whose city has no overnight day had no
 * cost and is dropped.
 *
 * Other costs become group totals divided by PAX. Per-PAX guide/staff-room amounts keep
 * their per-person value (total = amount × PAX); the shared meal/attraction amount is
 * converted with the smallest PAX tier. Frozen quote snapshots are not touched.
 */
export class PerDayHotelsAndTotalOtherCosts1796256009000 implements MigrationInterface {
  name = 'PerDayHotelsAndTotalOtherCosts1796256009000';

  async up(r: QueryRunner): Promise<void> {
    // The old (tier, city) uniqueness no longer holds once a city spans several nights.
    await r.query(`DO $$ DECLARE c record; BEGIN
      FOR c IN SELECT conname FROM pg_constraint
        WHERE conrelid='itinerary_hotels'::regclass AND contype='u'
      LOOP EXECUTE format('ALTER TABLE itinerary_hotels DROP CONSTRAINT %I', c.conname); END LOOP;
    END $$`);
    await r.query('ALTER TABLE itinerary_hotels ADD COLUMN day_id text');
    await r.query(`
      CREATE TEMP TABLE per_day_hotels ON COMMIT DROP AS
      SELECT h.*, d.id AS new_day_id,
        row_number() OVER (PARTITION BY h.itinerary_id ORDER BY h.position, d.day_number) - 1 AS new_position
      FROM itinerary_hotels h
      JOIN itinerary_days d ON d.itinerary_id=h.itinerary_id AND NOT d.is_deleted
        AND d.overnight_destination=h.destination`);
    await r.query(`
      DELETE FROM itinerary_hotels;
      UPDATE per_day_hotels SET day_id=new_day_id, position=new_position;
      ALTER TABLE per_day_hotels DROP COLUMN new_day_id, DROP COLUMN new_position;
      INSERT INTO itinerary_hotels SELECT * FROM per_day_hotels`);
    await r.query(`
      ALTER TABLE itinerary_hotels ALTER COLUMN day_id SET NOT NULL,
        ADD UNIQUE(itinerary_id,tier,day_id),
        ADD FOREIGN KEY(itinerary_id,day_id) REFERENCES itinerary_days(itinerary_id,id)`);

    await r.query(`
      UPDATE itinerary_pax_other_costs SET
        guide_other_cost=round(guide_other_cost*pax,2),
        staff_room_other_cost=round(staff_room_other_cost*pax,2)
      WHERE guide_other_cost IS NOT NULL OR staff_room_other_cost IS NOT NULL`);
    await r.query(`
      UPDATE itinerary_quote_settings s SET
        meal_other_cost=round(s.meal_other_cost*m.pax,2),
        attraction_other_cost=round(s.attraction_other_cost*m.pax,2)
      FROM (SELECT i.id, COALESCE((SELECT min(x) FROM unnest(i.pax_tiers) x),1) AS pax
            FROM itineraries i) m
      WHERE m.id=s.itinerary_id
        AND (s.meal_other_cost IS NOT NULL OR s.attraction_other_cost IS NOT NULL)`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Retain per-day hotels and total other costs when rolling back the application',
      ),
    );
  }
}
