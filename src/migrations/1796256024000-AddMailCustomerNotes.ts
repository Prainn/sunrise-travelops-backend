import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMailCustomerNotes1796256024000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE mail_threads
        ADD COLUMN manual_customer_name varchar(100),
        ADD COLUMN country_item_id uuid REFERENCES system_business_dictionary_items(id),
        ADD COLUMN planned_days integer CHECK (planned_days BETWEEN 1 AND 365),
        ADD COLUMN start_date date,
        ADD COLUMN pax integer CHECK (pax BETWEEN 1 AND 10000),
        ADD COLUMN destinations uuid[] NOT NULL DEFAULT '{}',
        ADD COLUMN internal_remark text NOT NULL DEFAULT '' CHECK (length(internal_remark) <= 20000),
        ADD COLUMN customer_notes_updated_at timestamptz;
      ALTER TABLE mail_messages ADD COLUMN customer_requirements text
        CHECK (direction = 'inbound' AND length(customer_requirements) <= 200000 OR customer_requirements IS NULL);
      INSERT INTO permissions(code,name) VALUES ('mail:thread:update','维护邮件客户资料');
      INSERT INTO role_permissions(role_id,permission_id)
        SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
        WHERE p.code='mail:thread:update' AND r.code IN ('ROOT','BUSINESS_MANAGER','COORDINATOR');
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM mail_threads WHERE customer_notes_updated_at IS NOT NULL OR manual_customer_name IS NOT NULL) THEN
          RAISE EXCEPTION 'Refusing rollback with recorded mail customer information';
        END IF;
      END $$;
      DELETE FROM role_permissions WHERE permission_id=(SELECT id FROM permissions WHERE code='mail:thread:update');
      DELETE FROM permissions WHERE code='mail:thread:update';
      ALTER TABLE mail_messages DROP COLUMN customer_requirements;
      ALTER TABLE mail_threads DROP COLUMN manual_customer_name, DROP COLUMN country_item_id,
        DROP COLUMN planned_days, DROP COLUMN start_date, DROP COLUMN pax, DROP COLUMN destinations,
        DROP COLUMN internal_remark, DROP COLUMN customer_notes_updated_at;
    `);
  }
}
