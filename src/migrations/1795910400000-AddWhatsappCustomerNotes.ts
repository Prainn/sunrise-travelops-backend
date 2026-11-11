import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsappCustomerNotes1795910400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE whatsapp_contacts ADD COLUMN manual_name varchar(100);
      CREATE TABLE whatsapp_customer_notes (
        conversation_id uuid PRIMARY KEY REFERENCES whatsapp_conversations(id),
        country_item_id uuid REFERENCES system_business_dictionary_items(id),
        planned_days integer CHECK(planned_days BETWEEN 1 AND 365),
        start_date date,
        pax integer CHECK(pax BETWEEN 1 AND 10000),
        contact_info varchar(500) NOT NULL DEFAULT '',
        destinations uuid[] NOT NULL DEFAULT '{}',
        requirements text NOT NULL DEFAULT '' CHECK(length(requirements)<=200000),
        internal_remark text NOT NULL DEFAULT '' CHECK(length(internal_remark)<=20000),
        updated_by uuid REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM whatsapp_customer_notes)
          OR EXISTS(SELECT 1 FROM whatsapp_contacts WHERE manual_name IS NOT NULL) THEN
          RAISE EXCEPTION 'Refusing rollback with WhatsApp customer notes or manual names';
        END IF;
      END $$;
      DROP TABLE whatsapp_customer_notes;
      ALTER TABLE whatsapp_contacts DROP COLUMN manual_name;
    `);
  }
}
