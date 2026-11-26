import { MigrationInterface, QueryRunner } from 'typeorm';

export class FeishuNotificationWindows1796256021000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`
      ALTER TABLE feishu_notification_settings
        ADD COLUMN window_start time(0), ADD COLUMN window_end time(0),
        ADD CHECK ((window_start IS NULL AND window_end IS NULL) OR
          (window_start IS NOT NULL AND window_end IS NOT NULL AND window_start<>window_end));
      CREATE FUNCTION feishu_window_resume(st time, en time, moment timestamptz)
      RETURNS timestamptz LANGUAGE sql IMMUTABLE STRICT AS $$
        SELECT CASE WHEN (st<en AND t::time>=st AND t::time<en)
                      OR (st>en AND (t::time>=st OR t::time<en)) THEN NULL
          ELSE ((t::date + CASE WHEN t::time>=st THEN 1 ELSE 0 END + st) AT TIME ZONE 'Asia/Shanghai') END
        FROM (SELECT moment AT TIME ZONE 'Asia/Shanghai' AS t) local_time
      $$;
      CREATE TABLE feishu_notification_digests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), open_id text NOT NULL, slot timestamptz NOT NULL,
        status text NOT NULL CHECK (status IN ('sending','retry','sent','skipped','failed','unknown')),
        claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(), attempts integer NOT NULL DEFAULT 1,
        retry_at timestamptz, message_id text, UNIQUE(open_id,slot)
      );
      CREATE INDEX feishu_digest_recent ON feishu_notification_digests(claimed_at DESC);
      ALTER TABLE whatsapp_notification_batches ADD COLUMN first_message_id uuid REFERENCES whatsapp_messages(id);
      ALTER TABLE whatsapp_notification_deliveries ADD COLUMN digest_at timestamptz, ADD COLUMN digest_id uuid REFERENCES feishu_notification_digests(id);
      ALTER TABLE feishu_ledger_notifications ADD COLUMN digest_at timestamptz, ADD COLUMN digest_id uuid REFERENCES feishu_notification_digests(id);
      ALTER TABLE inquiry_follow_up_reminders ADD COLUMN digest_at timestamptz, ADD COLUMN digest_id uuid REFERENCES feishu_notification_digests(id);
      CREATE INDEX whatsapp_digest_due ON whatsapp_notification_deliveries(digest_at,open_id) WHERE status='pending' AND digest_at IS NOT NULL;
      CREATE INDEX ledger_digest_due ON feishu_ledger_notifications(digest_at,recipient_id) WHERE status='pending' AND digest_at IS NOT NULL;
      CREATE INDEX inquiry_digest_due ON inquiry_follow_up_reminders(digest_at,inquiry_id) WHERE status='pending' AND digest_at IS NOT NULL;
      CREATE INDEX whatsapp_direct_due ON whatsapp_notification_deliveries(next_attempt_at,id) WHERE status='pending' AND digest_at IS NULL;
      CREATE INDEX ledger_direct_due ON feishu_ledger_notifications(next_attempt_at,id) WHERE status='pending' AND digest_at IS NULL;
      CREATE INDEX inquiry_direct_due ON inquiry_follow_up_reminders(due_at,id) WHERE status='pending' AND digest_at IS NULL;
      CREATE INDEX whatsapp_digest_members ON whatsapp_notification_deliveries(digest_id) WHERE digest_id IS NOT NULL AND status='pending';
      CREATE INDEX ledger_digest_members ON feishu_ledger_notifications(digest_id) WHERE digest_id IS NOT NULL AND status='pending';
      CREATE INDEX inquiry_digest_members ON inquiry_follow_up_reminders(digest_id) WHERE digest_id IS NOT NULL AND status='pending';
      CREATE VIEW feishu_pending_digest_items AS
        SELECT d.id, b.type, b.conversation_id AS subject_id, d.open_id, d.digest_at, d.digest_id,
          b.created_at, b.created_at AS occurred_at
        FROM whatsapp_notification_deliveries d JOIN whatsapp_notification_batches b ON b.id=d.batch_id
        WHERE d.status='pending' AND d.digest_at IS NOT NULL
        UNION ALL
        SELECT d.id, l.business_unit||'_ledger_'||d.kind, l.id, u.feishu_open_id, d.digest_at, d.digest_id, d.created_at,d.created_at
        FROM feishu_ledger_notifications d JOIN direct_ledgers l ON l.id=d.ledger_id JOIN users u ON u.id=d.recipient_id
        WHERE d.status='pending' AND d.digest_at IS NOT NULL
        UNION ALL
        SELECT d.id,'inquiry_follow_up',d.inquiry_id,coalesce(u.feishu_open_id,''),d.digest_at,d.digest_id,d.created_at,d.due_at
        FROM inquiry_follow_up_reminders d JOIN inquiries i ON i.id=d.inquiry_id LEFT JOIN users u ON u.id=i.owner_id
        WHERE d.status='pending' AND d.digest_at IS NOT NULL;
    `);
  }

  async down(q: QueryRunner) {
    await q.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM feishu_notification_settings WHERE window_start IS NOT NULL)
        OR EXISTS (SELECT 1 FROM feishu_notification_digests)
        OR EXISTS (SELECT 1 FROM feishu_pending_digest_items)
      THEN RAISE EXCEPTION 'Retain notification windows and delivery history'; END IF;
      END $$;
      DROP VIEW feishu_pending_digest_items;
      ALTER TABLE inquiry_follow_up_reminders DROP COLUMN digest_id, DROP COLUMN digest_at;
      ALTER TABLE feishu_ledger_notifications DROP COLUMN digest_id, DROP COLUMN digest_at;
      ALTER TABLE whatsapp_notification_deliveries DROP COLUMN digest_id, DROP COLUMN digest_at;
      ALTER TABLE whatsapp_notification_batches DROP COLUMN first_message_id;
      DROP TABLE feishu_notification_digests;
      DROP FUNCTION feishu_window_resume(time,time,timestamptz);
      ALTER TABLE feishu_notification_settings DROP COLUMN window_start, DROP COLUMN window_end;`);
  }
}
