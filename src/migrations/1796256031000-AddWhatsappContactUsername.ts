import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsappContactUsername1796256031000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE whatsapp_contacts
        ADD COLUMN username text,
        ADD COLUMN username_seen_at timestamptz;

      WITH latest AS (
        SELECT DISTINCT ON (v.contact_id) v.contact_id, u.username, m.occurred_at
        FROM whatsapp_events e
        JOIN whatsapp_messages m ON m.id=e.message_id AND m.account_id=e.account_id
        JOIN whatsapp_conversations v ON v.id=m.conversation_id AND v.account_id=m.account_id
        CROSS JOIN LATERAL (
          SELECT ltrim(btrim(e.payload->>'FromUserName'), '@') AS username
        ) u
        WHERE e.kind='inbound' AND e.state='done'
          AND m.direction='inbound' AND m.source='customer'
          AND coalesce(e.payload->>'NoticeType','inbound')<>'echos'
          AND jsonb_typeof(e.payload->'FromUserName')='string'
          AND length(e.payload->>'FromUserName')<=1000 AND u.username<>''
        ORDER BY v.contact_id, m.occurred_at DESC, m.seq DESC, e.received_at DESC, e.id DESC
      )
      UPDATE whatsapp_contacts p SET username=latest.username, username_seen_at=latest.occurred_at
      FROM latest WHERE p.id=latest.contact_id
    `);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE whatsapp_contacts DROP COLUMN username, DROP COLUMN username_seen_at
    `);
  }
}
