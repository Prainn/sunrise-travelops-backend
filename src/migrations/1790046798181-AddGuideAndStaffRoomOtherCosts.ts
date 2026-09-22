import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuideAndStaffRoomOtherCosts1790046798181 implements MigrationInterface {
  name = 'AddGuideAndStaffRoomOtherCosts1790046798181';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE itinerary_pax_other_costs(
      itinerary_id uuid NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
      position integer NOT NULL CHECK(position>=0),
      pax integer NOT NULL CHECK(pax BETWEEN 1 AND 10000),
      guide_other_cost numeric CHECK(guide_other_cost>=0),
      guide_other_reason text NOT NULL DEFAULT '',
      staff_room_other_cost numeric CHECK(staff_room_other_cost>=0),
      staff_room_other_reason text NOT NULL DEFAULT '',
      PRIMARY KEY(itinerary_id,position),
      UNIQUE(itinerary_id,pax)
    )`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Retain per-PAX guide and staff-room other costs when rolling back the application',
      ),
    );
  }
}
