import { MigrationInterface, QueryRunner } from 'typeorm';

export class ItineraryCustomerPresentation1796083201000 implements MigrationInterface {
  name = 'ItineraryCustomerPresentation1796083201000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE resource_cities ADD COLUMN english_name varchar(100) NOT NULL DEFAULT '';
      ALTER TABLE itineraries ADD COLUMN title_en varchar(300) NOT NULL DEFAULT '',
        ADD COLUMN customer_display_mode text NOT NULL DEFAULT 'same' CHECK(customer_display_mode IN ('same','returnArrival')),
        ADD COLUMN return_arrival_text varchar(2000) NOT NULL DEFAULT '返回温馨的家',
        ADD COLUMN return_arrival_text_en varchar(2000) NOT NULL DEFAULT 'Arrive home';
      ALTER TABLE itinerary_days ADD COLUMN via_destinations text[] NOT NULL DEFAULT '{}',
        ADD COLUMN departure_en varchar(300) NOT NULL DEFAULT '', ADD COLUMN destination_en varchar(300) NOT NULL DEFAULT '',
        ADD COLUMN transport_en varchar(100) NOT NULL DEFAULT '', ADD COLUMN description_en text NOT NULL DEFAULT '';
      ALTER TABLE itinerary_items ADD COLUMN resource_name_en varchar(500) NOT NULL DEFAULT '', ADD COLUMN remark_en text NOT NULL DEFAULT '';
      ALTER TABLE itinerary_quote_settings ADD COLUMN customer_notes_en text NOT NULL DEFAULT '',
        ADD COLUMN holiday_restrictions_en text NOT NULL DEFAULT '', ADD COLUMN hotel_replacement_terms_en text NOT NULL DEFAULT '';
      ALTER TABLE itinerary_transport_fees ADD COLUMN departure_city_en varchar(100) NOT NULL DEFAULT '', ADD COLUMN arrival_city_en varchar(100) NOT NULL DEFAULT '';
      ALTER TABLE itinerary_quote_options ALTER COLUMN hotel_tier DROP NOT NULL;
      ALTER TABLE quote_options ALTER COLUMN hotel_tier DROP NOT NULL;
      CREATE UNIQUE INDEX uq_itinerary_no_hotel_option ON itinerary_quote_options(itinerary_id,vehicle_tier) WHERE hotel_tier IS NULL;`);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Customer translations and no-hotel quotations must be retained; restore an approved matching backup',
      ),
    );
  }
}
