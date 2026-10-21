import { MigrationInterface, QueryRunner } from 'typeorm';

/** Breaking contract: phone is retained as contact info; old email/times are discarded. */
export class UpdateWebsiteInquiryFields1792886400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE website_inquiries RENAME COLUMN phone TO contact_info;
      ALTER TABLE website_inquiries
        ALTER COLUMN contact_info TYPE varchar(500),
        DROP COLUMN email,
        DROP COLUMN arrival_time,
        DROP COLUMN departure_time,
        ADD COLUMN received_date date,
        ADD COLUMN received_time varchar(5) NOT NULL DEFAULT ''
          CHECK(received_time = '' OR received_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
        ADD COLUMN contact_channel varchar(100) NOT NULL DEFAULT '',
        ADD COLUMN whatsapp_source_id varchar(200) NOT NULL DEFAULT '',
        ADD COLUMN website_inquiry_no varchar(200) NOT NULL DEFAULT '',
        ADD COLUMN landing_page varchar(2000) NOT NULL DEFAULT '',
        ADD COLUMN acquisition_source varchar(200) NOT NULL DEFAULT '';
      CREATE TABLE website_inquiry_numbers (
        code text PRIMARY KEY,
        creator_code varchar(10) NOT NULL,
        creation_date date NOT NULL,
        sequence integer NOT NULL CHECK(sequence > 0),
        UNIQUE(creator_code,creation_date,sequence)
      );
    `);
  }

  down(): Promise<void> {
    throw new Error(
      'UpdateWebsiteInquiryFields is irreversible: restore the pre-migration backup together with the matching application.',
    );
  }
}
