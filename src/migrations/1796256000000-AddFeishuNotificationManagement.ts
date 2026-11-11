import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddFeishuNotificationManagement1796256000000 implements MigrationInterface {
  name = 'AddFeishuNotificationManagement1796256000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
CREATE TABLE feishu_notification_settings (
  type text PRIMARY KEY CHECK(type IN ('whatsapp_unassigned','whatsapp_message','whatsapp_assignment','linxi_ledger_review','linxi_ledger_operate','website_ledger_review','website_ledger_operate','inquiry_follow_up')),
  enabled boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  last_disabled_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES users(id)
);
INSERT INTO feishu_notification_settings(type) VALUES
('whatsapp_unassigned'),('whatsapp_message'),('whatsapp_assignment'),('linxi_ledger_review'),('linxi_ledger_operate'),('website_ledger_review'),('website_ledger_operate'),('inquiry_follow_up');
ALTER TABLE inquiry_follow_up_reminders ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE whatsapp_notification_windows (
  conversation_id uuid PRIMARY KEY REFERENCES whatsapp_conversations(id), next_at timestamptz NOT NULL,
  type text NOT NULL REFERENCES feishu_notification_settings(type), setting_version integer NOT NULL
);
CREATE TABLE whatsapp_notification_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id),
  type text NOT NULL REFERENCES feishu_notification_settings(type) CHECK(type IN ('whatsapp_unassigned','whatsapp_message','whatsapp_assignment')),
  owner_id uuid REFERENCES users(id), previous_owner_id uuid REFERENCES users(id), assignment_version integer,
  message_count integer NOT NULL DEFAULT 0 CHECK(message_count>=0), latest_message_id uuid REFERENCES whatsapp_messages(id),
  due_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','skipped','cancelled')),
  error_code text, UNIQUE(conversation_id,assignment_version)
);
CREATE INDEX whatsapp_notification_batches_pending ON whatsapp_notification_batches(conversation_id,due_at) WHERE status='pending';
CREATE TABLE whatsapp_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES whatsapp_notification_batches(id),
  recipient_id uuid NOT NULL REFERENCES users(id), open_id varchar(100) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','unknown','skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at timestamptz NOT NULL,
  claimed_at timestamptz, sent_at timestamptz, message_id text, error_code text,
  UNIQUE(batch_id,open_id)
);
CREATE INDEX whatsapp_notification_deliveries_due ON whatsapp_notification_deliveries(next_attempt_at,id) WHERE status='pending';
INSERT INTO permissions(code,name) VALUES ('sys:notification:list','查看通知管理'),('sys:notification:update','配置通知开关') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code IN ('ROOT','ADMIN') AND p.code IN ('sys:notification:list','sys:notification:update') ON CONFLICT DO NOTHING;
UPDATE role_menu_configs c SET menu_keys=array_append(c.menu_keys,'notifications'),version=version+1,updated_at=now() FROM roles r WHERE r.id=c.role_id AND r.code IN ('ROOT','ADMIN') AND NOT ('notifications'=ANY(c.menu_keys));
`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ BEGIN
IF EXISTS(SELECT 1 FROM whatsapp_notification_batches) OR EXISTS(SELECT 1 FROM feishu_notification_settings WHERE version<>1) THEN
RAISE EXCEPTION 'Notification settings and delivery audit must be retained'; END IF; END $$;
DROP TABLE whatsapp_notification_deliveries;
DROP TABLE whatsapp_notification_batches;
DROP TABLE whatsapp_notification_windows;
DROP TABLE feishu_notification_settings;
ALTER TABLE inquiry_follow_up_reminders DROP COLUMN created_at;
UPDATE role_menu_configs SET menu_keys=array_remove(menu_keys,'notifications');
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('sys:notification:list','sys:notification:update'));
DELETE FROM permissions WHERE code IN ('sys:notification:list','sys:notification:update');`);
  }
}
