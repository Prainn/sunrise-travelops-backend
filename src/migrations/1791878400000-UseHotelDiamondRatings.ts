import { MigrationInterface, QueryRunner } from 'typeorm';

// Public hotel ratings and editable itinerary hotel tiers become 3/4/5 diamonds.
// Frozen quote tables and snapshots keep their original text values.
export class UseHotelDiamondRatings1791878400000 implements MigrationInterface {
  name = 'UseHotelDiamondRatings1791878400000';

  async up(q: QueryRunner): Promise<void> {
    const toNumber = (column: string) =>
      `CASE ${column} WHEN 'international_five_star' THEN 5 WHEN 'ctrip_preferred' THEN 4 WHEN 'preferred_non_five_star' THEN 4 ELSE ${column}::integer END`;
    await q.query(
      `ALTER TABLE resource_hotels DROP CONSTRAINT IF EXISTS "CHK_resource_hotels_rating"`,
    );
    await q.query(
      `ALTER TABLE resource_hotels ALTER COLUMN rating TYPE smallint USING (${toNumber('rating')})`,
    );
    await q.query(
      `ALTER TABLE resource_hotels ADD CONSTRAINT "CHK_resource_hotels_rating" CHECK ("rating" IN (3, 4, 5))`,
    );
    // The hotel FK is auto-named, so drop it by definition before retyping both sides.
    await q.query(`
      DO $$ DECLARE c record; BEGIN
        FOR c IN SELECT conname FROM pg_constraint
          WHERE conrelid='itinerary_hotels'::regclass AND contype='f'
            AND confrelid='itinerary_hotel_plans'::regclass
        LOOP EXECUTE format('ALTER TABLE itinerary_hotels DROP CONSTRAINT %I', c.conname); END LOOP;
      END $$`);
    await q.query(
      `ALTER TABLE itinerary_hotel_plans ALTER COLUMN tier TYPE integer USING (${toNumber('tier')})`,
    );
    await q.query(
      `ALTER TABLE itinerary_hotels ALTER COLUMN tier TYPE integer USING (${toNumber('tier')}), ALTER COLUMN rating TYPE integer USING (${toNumber('rating')})`,
    );
    await q.query(
      `ALTER TABLE itinerary_hotels ADD FOREIGN KEY(itinerary_id,tier) REFERENCES itinerary_hotel_plans(itinerary_id,tier)`,
    );
    await q.query(
      `ALTER TABLE itinerary_quote_options ALTER COLUMN hotel_tier TYPE integer USING (${toNumber('hotel_tier')})`,
    );
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('UseHotelDiamondRatings cannot be reverted automatically'),
    );
  }
}
