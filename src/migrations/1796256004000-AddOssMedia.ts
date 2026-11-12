import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOssMedia1796256004000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE oss_resources (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      environment varchar(4) NOT NULL CHECK(environment IN ('dev','prod')),
      name varchar(200) NOT NULL,
      remark varchar(1000) NOT NULL DEFAULT '',
      kind varchar(16) NOT NULL CHECK(kind IN ('image','sticker')),
      source varchar(16) NOT NULL CHECK(source IN ('whatsapp','upload','management')),
      source_url text,
      message_id uuid UNIQUE REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
      conversation_id uuid REFERENCES whatsapp_conversations(id),
      actor_id uuid REFERENCES users(id),
      state varchar(16) NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','ready','failed','deleting')),
      object_key text UNIQUE,
      thumbnail_key text,
      send_key text,
      mime_type varchar(100),
      size integer CHECK(size>0 AND size<=5242880),
      width integer,
      height integer,
      attempts integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL DEFAULT now(),
      error_code varchar(80),
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK(object_key IS NULL OR object_key LIKE environment || '/%'),
      CHECK(thumbnail_key IS NULL OR thumbnail_key LIKE environment || '/%'),
      CHECK(send_key IS NULL OR send_key LIKE environment || '/%')
    );
    CREATE INDEX oss_resources_pending ON oss_resources(environment,state,available_at);
    CREATE INDEX oss_resources_conversation ON oss_resources(conversation_id);
    INSERT INTO permissions(code,name) VALUES
      ('sys:oss:list','查看OSS资源'),('sys:oss:create','上传OSS资源'),
      ('sys:oss:update','编辑OSS资源'),('sys:oss:delete','删除OSS资源')
      ON CONFLICT(code) DO NOTHING;
    INSERT INTO role_permissions(role_id,permission_id)
      SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
      WHERE r.code IN ('ROOT','ADMIN') AND p.code LIKE 'sys:oss:%'
      ON CONFLICT DO NOTHING;`);
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query(`DROP TABLE oss_resources;
      DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code LIKE 'sys:oss:%');
      DELETE FROM permissions WHERE code LIKE 'sys:oss:%'`);
  }
}
