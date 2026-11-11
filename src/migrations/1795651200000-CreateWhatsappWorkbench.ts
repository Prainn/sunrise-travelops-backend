import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWhatsappWorkbench1795651200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE whatsapp_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id text NOT NULL,
        waba_id text NOT NULL, phone text NOT NULL, business_unit text NOT NULL DEFAULT 'website' CHECK(business_unit='website'),
        UNIQUE(space_id,phone)
      );
      CREATE TABLE whatsapp_contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES whatsapp_accounts(id),
        name text NOT NULL DEFAULT '', bsuid text, phone text, last_inbound_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(account_id,id)
      );
      CREATE TABLE whatsapp_identities (
        account_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('bsuid','phone')), value text NOT NULL,
        contact_id uuid NOT NULL, PRIMARY KEY(account_id,kind,value),
        FOREIGN KEY(account_id,contact_id) REFERENCES whatsapp_contacts(account_id,id)
      );
      CREATE TABLE whatsapp_conversations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, contact_id uuid NOT NULL,
        owner_id uuid REFERENCES users(id), inquiry_id uuid UNIQUE REFERENCES website_inquiries(id),
        state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed','archived')),
        assignment_locked_at timestamptz, previous_id uuid UNIQUE REFERENCES whatsapp_conversations(id),
        version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY(account_id,contact_id) REFERENCES whatsapp_contacts(account_id,id), UNIQUE(account_id,id)
      );
      CREATE UNIQUE INDEX whatsapp_one_current ON whatsapp_conversations(account_id,contact_id) WHERE state<>'archived';
      CREATE TABLE whatsapp_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seq bigserial UNIQUE NOT NULL,
        account_id uuid NOT NULL, conversation_id uuid NOT NULL,
        provider_id text, task_id text, client_request_id uuid, retry_of uuid REFERENCES whatsapp_messages(id),
        direction text NOT NULL CHECK(direction IN ('inbound','outbound')),
        source text NOT NULL CHECK(source IN ('customer','mobile','system')),
        kind text NOT NULL, text text NOT NULL DEFAULT '', attachment jsonb,
        status text NOT NULL CHECK(status IN ('received','queued','sending','accepted','sent','delivered','read','failed','unknown')),
        actor_id uuid REFERENCES users(id), actor_identity_id uuid REFERENCES user_identities(id), occurred_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        error_code text, attempts integer NOT NULL DEFAULT 0,
        FOREIGN KEY(account_id,conversation_id) REFERENCES whatsapp_conversations(account_id,id),
        UNIQUE(account_id,provider_id), UNIQUE(account_id,task_id), UNIQUE(conversation_id,client_request_id)
      );
      CREATE INDEX whatsapp_messages_conversation_seq ON whatsapp_messages(conversation_id,seq);
      CREATE INDEX whatsapp_messages_pending ON whatsapp_messages(status,created_at) WHERE status IN ('queued','sending');
      CREATE TABLE whatsapp_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES whatsapp_accounts(id),
        event_key text NOT NULL, payload jsonb NOT NULL, kind text NOT NULL,
        state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done','failed')),
        attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
        error_code text, message_id uuid REFERENCES whatsapp_messages(id),
        received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
        UNIQUE(account_id,event_key)
      );
      CREATE INDEX whatsapp_events_pending ON whatsapp_events(available_at,received_at) WHERE state='pending';
      CREATE TABLE whatsapp_reads (
        conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id), user_id uuid NOT NULL REFERENCES users(id),
        last_seq bigint NOT NULL DEFAULT 0 CHECK(last_seq>=0), updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(conversation_id,user_id)
      );
      CREATE TABLE whatsapp_actions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id),
        actor_id uuid REFERENCES users(id), action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE whatsapp_message_sources (
        message_id uuid PRIMARY KEY REFERENCES whatsapp_messages(id), source_reference text NOT NULL UNIQUE,
        website_inquiry_no text NOT NULL DEFAULT '', landing_page text NOT NULL DEFAULT '', acquisition_source text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE direct_ledgers ADD COLUMN website_inquiry_id uuid REFERENCES website_inquiries(id);
      CREATE UNIQUE INDEX direct_ledger_website_inquiry_unique ON direct_ledgers(website_inquiry_id) WHERE website_inquiry_id IS NOT NULL;
      ALTER TABLE direct_ledgers ADD CONSTRAINT direct_ledger_inquiry_website_only CHECK(website_inquiry_id IS NULL OR business_unit='website');
      CREATE FUNCTION whatsapp_lock_ledger_owner() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE i website_inquiries%ROWTYPE;
      BEGIN
        IF TG_OP='UPDATE' AND OLD.website_inquiry_id IS DISTINCT FROM NEW.website_inquiry_id THEN
          RAISE EXCEPTION 'Linked inquiry cannot be changed' USING ERRCODE='23514';
        END IF;
        IF NEW.website_inquiry_id IS NOT NULL THEN
          SELECT * INTO i FROM website_inquiries WHERE id=NEW.website_inquiry_id FOR UPDATE;
          IF i.business_unit<>'website' OR i.deleted_at IS NOT NULL OR i.owner_id IS DISTINCT FROM NEW.creator_id THEN
            RAISE EXCEPTION 'Ledger inquiry owner or scope mismatch' USING ERRCODE='23514';
          END IF;
          UPDATE whatsapp_conversations SET assignment_locked_at=coalesce(assignment_locked_at,now()),version=version+1,updated_at=now()
          WHERE inquiry_id=NEW.website_inquiry_id AND assignment_locked_at IS NULL;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER whatsapp_ledger_owner BEFORE INSERT OR UPDATE OF website_inquiry_id,creator_id ON direct_ledgers
        FOR EACH ROW EXECUTE FUNCTION whatsapp_lock_ledger_owner();
      CREATE FUNCTION whatsapp_sync_inquiry_owner() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.owner_id IS DISTINCT FROM NEW.owner_id THEN
          IF EXISTS(SELECT 1 FROM whatsapp_conversations WHERE inquiry_id=OLD.id AND (assignment_locked_at IS NOT NULL OR state='archived'))
            OR EXISTS(SELECT 1 FROM direct_ledgers WHERE website_inquiry_id=OLD.id)
            OR (EXISTS(SELECT 1 FROM whatsapp_conversations WHERE inquiry_id=OLD.id) AND EXISTS(SELECT 1 FROM tours WHERE source_module='website' AND inquiry_id=OLD.id)) THEN
            RAISE EXCEPTION 'WhatsApp inquiry assignment locked' USING ERRCODE='23514';
          END IF;
          UPDATE whatsapp_conversations SET owner_id=NEW.owner_id,version=version+1,updated_at=now() WHERE inquiry_id=OLD.id;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER whatsapp_inquiry_owner BEFORE UPDATE OF owner_id ON website_inquiries FOR EACH ROW EXECUTE FUNCTION whatsapp_sync_inquiry_owner();
      INSERT INTO permissions(code,name) VALUES
        ('whatsapp:conversation:list','查看WhatsApp会话'),('whatsapp:message:send','回复WhatsApp消息'),
        ('whatsapp:conversation:assign','分配WhatsApp会话'),('whatsapp:inquiry:create','会话创建询盘'),
        ('whatsapp:conversation:update','管理本人WhatsApp咨询'),('whatsapp:integration:manage','管理WhatsApp接入') ON CONFLICT(code) DO NOTHING;
      INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
        WHERE p.code LIKE 'whatsapp:%' AND (r.code='ROOT' OR (r.code='BUSINESS_MANAGER' AND p.code<>'whatsapp:integration:manage')
        OR (r.code='COORDINATOR' AND p.code NOT IN ('whatsapp:conversation:assign','whatsapp:integration:manage'))) ON CONFLICT DO NOTHING;
      UPDATE role_menu_configs c SET menu_keys=ARRAY(SELECT DISTINCT unnest(c.menu_keys || CASE r.code
        WHEN 'ROOT' THEN ARRAY['whatsapp-inbox','whatsapp-management','whatsapp-integration']
        WHEN 'BUSINESS_MANAGER' THEN ARRAY['whatsapp-inbox','whatsapp-management'] ELSE ARRAY['whatsapp-inbox'] END)),version=version+1,updated_at=now()
        FROM roles r WHERE r.id=c.role_id AND r.code IN ('ROOT','BUSINESS_MANAGER','COORDINATOR');
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM whatsapp_conversations) OR EXISTS(SELECT 1 FROM whatsapp_events)
        OR EXISTS(SELECT 1 FROM direct_ledgers WHERE website_inquiry_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Refusing rollback with WhatsApp data; retain additive schema and roll back application only';
      END IF; END $$;
      DROP TRIGGER whatsapp_ledger_owner ON direct_ledgers;
      DROP TRIGGER whatsapp_inquiry_owner ON website_inquiries;
      DROP FUNCTION whatsapp_lock_ledger_owner(); DROP FUNCTION whatsapp_sync_inquiry_owner();
      ALTER TABLE direct_ledgers DROP COLUMN website_inquiry_id;
      DROP TABLE whatsapp_message_sources,whatsapp_actions,whatsapp_reads,whatsapp_events,whatsapp_messages,whatsapp_conversations,whatsapp_identities,whatsapp_contacts,whatsapp_accounts;
      UPDATE role_menu_configs SET menu_keys=array_remove(array_remove(array_remove(menu_keys,'whatsapp-inbox'),'whatsapp-management'),'whatsapp-integration'),version=version+1,updated_at=now()
        WHERE menu_keys && ARRAY['whatsapp-inbox','whatsapp-management','whatsapp-integration'];
      DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code LIKE 'whatsapp:%');
      DELETE FROM permissions WHERE code LIKE 'whatsapp:%';`);
  }
}
