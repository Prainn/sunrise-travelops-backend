import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsappEventMessageIndex1795996800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'CREATE INDEX whatsapp_events_message ON whatsapp_events(message_id) WHERE message_id IS NOT NULL',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX whatsapp_events_message');
  }
}
