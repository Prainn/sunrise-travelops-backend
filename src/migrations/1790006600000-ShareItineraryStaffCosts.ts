import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShareItineraryStaffCosts1790006600000 implements MigrationInterface {
  name = 'ShareItineraryStaffCosts1790006600000';

  async up(q: QueryRunner): Promise<void> {
    // Unequal option costs cannot be merged without a business decision.
    const conflicts = (await q.query(`
      SELECT itinerary_id FROM itinerary_quote_options
      GROUP BY itinerary_id HAVING count(DISTINCT coalesce(guide_service_total,0))>1
      UNION
      SELECT o.itinerary_id FROM itinerary_quote_options o
      JOIN itinerary_destinations d ON d.itinerary_id=o.itinerary_id
      LEFT JOIN itinerary_staff_room_costs c
        ON c.itinerary_id=o.itinerary_id AND c.option_id=o.id AND c.destination=d.destination
      GROUP BY o.itinerary_id,d.destination HAVING count(DISTINCT coalesce(c.total,0))>1
    `)) as Array<{ itinerary_id: string }>;
    if (conflicts.length) {
      throw new Error(
        `Conflicting shared staff costs for itineraries: ${conflicts.map((row) => row.itinerary_id).join(', ')}`,
      );
    }
    await q.query(`
      ALTER TABLE itinerary_quote_settings
        ADD COLUMN guide_service_total numeric CHECK(guide_service_total>=0);
      UPDATE itinerary_quote_settings s SET guide_service_total=o.total
      FROM (SELECT itinerary_id,max(guide_service_total) total FROM itinerary_quote_options GROUP BY itinerary_id) o
      WHERE s.itinerary_id=o.itinerary_id;
      CREATE TABLE itinerary_shared_staff_room_costs(
        itinerary_id uuid NOT NULL REFERENCES itineraries(id),
        position integer NOT NULL CHECK(position>=0),
        destination text NOT NULL,
        total numeric CHECK(total>=0),
        PRIMARY KEY(itinerary_id,destination),
        UNIQUE(itinerary_id,position)
      );
      INSERT INTO itinerary_shared_staff_room_costs(itinerary_id,position,destination,total)
      SELECT d.itinerary_id,d.position,d.destination,max(c.total)
      FROM itinerary_destinations d
      LEFT JOIN itinerary_staff_room_costs c ON c.itinerary_id=d.itinerary_id AND c.destination=d.destination
      GROUP BY d.itinerary_id,d.position,d.destination;
      DROP TABLE itinerary_staff_room_costs;
      ALTER TABLE itinerary_quote_options DROP COLUMN guide_service_total, DROP COLUMN staff_room_total;
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Restore the pre-migration database backup and matching application to recover option-level staff costs',
      ),
    );
  }
}
