import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsappQuickReplies1795824000000 implements MigrationInterface {
  name = 'AddWhatsappQuickReplies1795824000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE whatsapp_quick_replies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        stage varchar(100) NOT NULL CHECK(length(trim(stage))>0),
        scenario varchar(100) NOT NULL CHECK(length(trim(scenario))>0),
        content text NOT NULL CHECK(length(trim(content)) BETWEEN 1 AND 4096),
        enabled boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 10000),
        version integer NOT NULL DEFAULT 1 CHECK(version>0),
        created_by uuid REFERENCES users(id), updated_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(stage,scenario)
      );
      INSERT INTO permissions(code,name) VALUES('whatsapp:quick-reply:manage','维护WhatsApp快捷回复') ON CONFLICT(code) DO NOTHING;
      INSERT INTO role_permissions(role_id,permission_id)
        SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
        WHERE r.code IN ('ROOT','BUSINESS_MANAGER') AND p.code='whatsapp:quick-reply:manage' ON CONFLICT DO NOTHING;
      UPDATE role_menu_configs c SET menu_keys=array_append(c.menu_keys,'whatsapp-quick-replies'),version=c.version+1,updated_at=now()
        FROM roles r WHERE r.id=c.role_id AND r.code IN ('ROOT','BUSINESS_MANAGER') AND NOT ('whatsapp-quick-replies'=ANY(c.menu_keys));
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM whatsapp_quick_replies) THEN RAISE EXCEPTION 'Refusing rollback with quick reply data'; END IF;
      END $$;
      DROP TABLE whatsapp_quick_replies;
      UPDATE role_menu_configs SET menu_keys=array_remove(menu_keys,'whatsapp-quick-replies'),version=version+1,updated_at=now();
      DELETE FROM role_permissions WHERE permission_id IN(SELECT id FROM permissions WHERE code='whatsapp:quick-reply:manage');
      DELETE FROM permissions WHERE code='whatsapp:quick-reply:manage';`);
  }
}
