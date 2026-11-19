import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStandardQuoteCharges1796256010000 implements MigrationInterface {
  name = 'AddStandardQuoteCharges1796256010000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE itinerary_quote_settings
        ADD COLUMN leader_room_total numeric(16,2) CHECK (leader_room_total >= 0),
        ADD COLUMN driver_tip_total numeric(16,2) CHECK (driver_tip_total >= 0),
        ADD COLUMN guide_leader_transport_total numeric(16,2) CHECK (guide_leader_transport_total >= 0),
        ADD COLUMN ground_handling_unit_cost numeric(16,2) CHECK (ground_handling_unit_cost >= 0);
      ALTER TABLE itinerary_pax_prices
        ADD COLUMN single_supplement_quote numeric(16,2) CHECK (single_supplement_quote >= 0);
      ALTER TABLE quote_pax_prices
        ADD COLUMN leader_room_unit_cost numeric(16,2),
        ADD COLUMN driver_tip_unit_cost numeric(16,2),
        ADD COLUMN guide_leader_transport_unit_cost numeric(16,2),
        ADD COLUMN ground_handling_unit_cost numeric(16,2),
        ADD COLUMN single_supplement_quote numeric(16,2);
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Preserve entered charges and frozen customer prices; retain the additive columns.',
      ),
    );
  }
}
