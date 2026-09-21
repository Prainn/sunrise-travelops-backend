import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStaffRoomCostsByDestination1790006500000 implements MigrationInterface {
  name = 'AddStaffRoomCostsByDestination1790006500000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE itinerary_staff_room_costs(
        itinerary_id uuid NOT NULL,
        option_id text NOT NULL,
        position integer NOT NULL CHECK(position>=0),
        destination text NOT NULL,
        total numeric CHECK(total>=0),
        PRIMARY KEY(itinerary_id,option_id,destination),
        UNIQUE(itinerary_id,option_id,position),
        FOREIGN KEY(itinerary_id,option_id) REFERENCES itinerary_quote_options(itinerary_id,id)
      );
      INSERT INTO itinerary_staff_room_costs(itinerary_id,option_id,position,destination,total)
      SELECT option.itinerary_id,option.id,0,destination.destination,option.staff_room_total
      FROM itinerary_quote_options option
      JOIN LATERAL (
        SELECT value.destination
        FROM itinerary_destinations value
        WHERE value.itinerary_id=option.itinerary_id
        ORDER BY value.position
        LIMIT 1
      ) destination ON true
      WHERE option.staff_room_total IS NOT NULL;
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE itinerary_quote_options option
      SET staff_room_total=cost.total
      FROM (
        SELECT itinerary_id,option_id,sum(total) AS total
        FROM itinerary_staff_room_costs
        GROUP BY itinerary_id,option_id
      ) cost
      WHERE cost.itinerary_id=option.itinerary_id AND cost.option_id=option.id;
      DROP TABLE itinerary_staff_room_costs;
    `);
  }
}
