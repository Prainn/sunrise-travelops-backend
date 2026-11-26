import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMailInbox1796256022000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE mail_threads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mailbox text NOT NULL, subject text NOT NULL,
        customer_email text NOT NULL, customer_name text NOT NULL DEFAULT '',
        has_inbound boolean NOT NULL, last_at timestamptz NOT NULL, owner_id uuid REFERENCES users(id),
        inquiry_id uuid UNIQUE REFERENCES website_inquiries(id), source_message_id uuid,
        assignment_locked boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1
      );
      CREATE INDEX mail_threads_activity ON mail_threads(last_at DESC,id);
      CREATE INDEX mail_threads_owner ON mail_threads(owner_id,last_at DESC);
      CREATE TABLE mail_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thread_id uuid NOT NULL REFERENCES mail_threads(id),
        provider_id text UNIQUE, internet_id text, refs text[] NOT NULL DEFAULT '{}',
        direction text NOT NULL CHECK(direction IN ('inbound','outbound')),
        state text NOT NULL CHECK(state IN ('received','draft','preparing','sending','unknown','failed','sent')),
        subject text NOT NULL, sender jsonb NOT NULL, recipients jsonb NOT NULL DEFAULT '[]',
        cc jsonb NOT NULL DEFAULT '[]', reply_to jsonb NOT NULL DEFAULT '[]', body text NOT NULL DEFAULT '',
        occurred_at timestamptz NOT NULL DEFAULT now(), is_read boolean NOT NULL DEFAULT false,
        actor_id uuid REFERENCES users(id), original_id uuid REFERENCES mail_messages(id), signature text,
        remote_draft_id text, version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(thread_id,id)
      );
      ALTER TABLE mail_threads ADD CONSTRAINT mail_source_in_thread FOREIGN KEY(id,source_message_id) REFERENCES mail_messages(thread_id,id);
      CREATE INDEX mail_unread_messages ON mail_messages(thread_id) WHERE direction='inbound' AND NOT is_read;
      CREATE INDEX mail_thread_messages ON mail_messages(thread_id,occurred_at,id);
      CREATE UNIQUE INDEX mail_received_internet_id ON mail_messages(thread_id,internet_id) WHERE internet_id IS NOT NULL AND direction='inbound';
      CREATE UNIQUE INDEX mail_active_reply ON mail_messages(original_id,actor_id) WHERE state IN ('draft','preparing','sending','unknown','failed');
      CREATE TABLE mail_thread_keys(mailbox text NOT NULL, internet_id text NOT NULL, thread_id uuid NOT NULL REFERENCES mail_threads(id), PRIMARY KEY(mailbox,internet_id));
      CREATE TABLE mail_attachments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES mail_messages(id),
        provider_id text, file_name text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>=0),
        object_key text, removed_at timestamptz, retry_at timestamptz NOT NULL DEFAULT now(), UNIQUE(message_id,provider_id)
      );
      CREATE INDEX mail_attachments_pending ON mail_attachments(retry_at) WHERE object_key IS NULL AND provider_id IS NOT NULL;
      CREATE TABLE mail_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),thread_id uuid NOT NULL REFERENCES mail_threads(id),actor_id uuid NOT NULL REFERENCES users(id),
        previous_owner_id uuid REFERENCES users(id),owner_id uuid NOT NULL REFERENCES users(id),reason text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX mail_assignments_thread ON mail_assignments(thread_id,created_at);
      CREATE TABLE mail_sync(mailbox text NOT NULL,folder text NOT NULL,start_at timestamptz NOT NULL,floor_at timestamptz NOT NULL,end_at timestamptz,cursor text,PRIMARY KEY(mailbox,folder));
      CREATE FUNCTION mail_lock_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_TABLE_NAME='direct_ledgers' THEN
          UPDATE mail_threads SET assignment_locked=true,version=version+1 WHERE inquiry_id=NEW.website_inquiry_id AND NOT assignment_locked;
        ELSIF NEW.source_module='website' THEN
          UPDATE mail_threads SET assignment_locked=true,version=version+1 WHERE inquiry_id=NEW.inquiry_id AND NOT assignment_locked;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER mail_ledger_lock AFTER INSERT OR UPDATE OF website_inquiry_id ON direct_ledgers FOR EACH ROW EXECUTE FUNCTION mail_lock_assignment();
      CREATE TRIGGER mail_tour_lock AFTER INSERT OR UPDATE OF inquiry_id ON tours FOR EACH ROW EXECUTE FUNCTION mail_lock_assignment();
      INSERT INTO permissions(code,name) VALUES ('mail:thread:list','查看邮件会话'),('mail:thread:assign','分配邮件会话'),('mail:message:send','回复邮件'),('mail:inquiry:create','从邮件创建询盘');
      INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE p.code LIKE 'mail:%' AND
        (r.code IN ('ROOT','BUSINESS_MANAGER') OR (r.code='COORDINATOR' AND p.code<>'mail:thread:assign')) ON CONFLICT DO NOTHING;
      UPDATE role_menu_configs c SET menu_keys=array_append(menu_keys,'mail-inbox'),version=version+1 FROM roles r
        WHERE r.id=c.role_id AND r.code IN ('ROOT','BUSINESS_MANAGER','COORDINATOR') AND NOT ('mail-inbox'=ANY(menu_keys));
    `);
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query(`
      UPDATE role_menu_configs SET menu_keys=array_remove(menu_keys,'mail-inbox'),version=version+1 WHERE 'mail-inbox'=ANY(menu_keys);
      DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code LIKE 'mail:%');
      DELETE FROM permissions WHERE code LIKE 'mail:%';
      DROP TRIGGER mail_ledger_lock ON direct_ledgers; DROP TRIGGER mail_tour_lock ON tours; DROP FUNCTION mail_lock_assignment();
      ALTER TABLE mail_threads DROP CONSTRAINT mail_source_in_thread;
      DROP TABLE mail_sync,mail_assignments,mail_attachments,mail_thread_keys,mail_messages,mail_threads;
    `);
  }
}
