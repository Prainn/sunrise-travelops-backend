import { MigrationInterface, QueryRunner } from 'typeorm';

const existingTypes = `'whatsapp_unassigned','whatsapp_message','whatsapp_assignment','linxi_ledger_review',
  'linxi_ledger_operate','website_ledger_review','website_ledger_operate','inquiry_follow_up'`;
export class AddMailUnassignedNotifications1796256028000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`
      ALTER TABLE feishu_notification_settings DROP CONSTRAINT feishu_notification_settings_type_check,
        ADD CONSTRAINT feishu_notification_settings_type_check CHECK(type IN (${existingTypes},'mail_unassigned'));
      INSERT INTO feishu_notification_settings(type) VALUES ('mail_unassigned');
      ALTER TABLE mail_sync ADD COLUMN notify_after timestamptz NOT NULL DEFAULT now();
      CREATE TABLE mail_notification_deliveries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL REFERENCES mail_threads(id),
        first_message_id uuid NOT NULL, recipient_id uuid NOT NULL REFERENCES users(id), open_id varchar(100) NOT NULL,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','unknown','skipped')),
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0), next_attempt_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz, sent_at timestamptz, message_id text,
        error_code text, digest_at timestamptz, digest_id uuid REFERENCES feishu_notification_digests(id),
        UNIQUE(thread_id,open_id), FOREIGN KEY(thread_id,first_message_id) REFERENCES mail_messages(thread_id,id)
      );
      CREATE INDEX mail_notification_direct_due ON mail_notification_deliveries(next_attempt_at,id)
        WHERE status='pending' AND digest_at IS NULL;
      CREATE INDEX mail_notification_digest_due ON mail_notification_deliveries(digest_at,open_id)
        WHERE status='pending' AND digest_at IS NOT NULL;
      CREATE INDEX mail_notification_digest_members ON mail_notification_deliveries(digest_id)
        WHERE status='pending' AND digest_id IS NOT NULL;
      -- Older workers still read the original view after an application rollback.
      CREATE VIEW feishu_pending_digest_items_with_mail AS
      SELECT id,type,subject_id,open_id,digest_at,digest_id,created_at,occurred_at FROM feishu_pending_digest_items
      UNION ALL
      SELECT id,'mail_unassigned',thread_id,open_id,digest_at,digest_id,created_at,created_at
      FROM mail_notification_deliveries WHERE status='pending' AND digest_at IS NOT NULL;
    `);
  }

  async down(q: QueryRunner) {
    await q.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM mail_notification_deliveries) OR EXISTS (
          SELECT 1 FROM feishu_notification_settings WHERE type='mail_unassigned' AND version<>1
        ) THEN RAISE EXCEPTION 'Retain mail notification settings and delivery history'; END IF;
      END $$;
      DROP VIEW feishu_pending_digest_items_with_mail;
      DROP TABLE mail_notification_deliveries;
      ALTER TABLE mail_sync DROP COLUMN notify_after;
      DELETE FROM feishu_notification_settings WHERE type='mail_unassigned';
      ALTER TABLE feishu_notification_settings DROP CONSTRAINT feishu_notification_settings_type_check,
        ADD CONSTRAINT feishu_notification_settings_type_check CHECK(type IN (${existingTypes}));
    `);
  }
}
