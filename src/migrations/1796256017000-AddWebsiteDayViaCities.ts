import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebsiteDayViaCities1796256017000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Saves replace the day rows. Keep stops keyed by the stable itinerary/day
    // pair so an older server rewriting those rows preserves their route.
    await runner.query(`CREATE TABLE website_day_via_cities (
      itinerary_id uuid NOT NULL REFERENCES website_itineraries(id) ON DELETE CASCADE,
      day_id uuid NOT NULL,
      position integer NOT NULL CHECK (position BETWEEN 0 AND 364),
      city_id uuid NOT NULL,
      PRIMARY KEY (itinerary_id, day_id, position),
      UNIQUE (itinerary_id, day_id, city_id)
    )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN
      IF EXISTS (SELECT FROM website_day_via_cities) THEN
        RAISE EXCEPTION 'Website day via cities are in use';
      END IF;
    END $$`);
    await runner.query('DROP TABLE website_day_via_cities');
  }
}
