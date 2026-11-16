import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsappRuntimeSettings1796256008000 implements MigrationInterface {
  name = 'AddWhatsappRuntimeSettings1796256008000';

  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE whatsapp_runtime_settings (
        id smallint PRIMARY KEY CHECK(id=1),
        inbound_enabled boolean NOT NULL DEFAULT true,
        outbound_enabled boolean NOT NULL DEFAULT true,
        version integer NOT NULL DEFAULT 1 CHECK(version>=1),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO whatsapp_runtime_settings(id) VALUES (1);
    `);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE whatsapp_runtime_settings');
  }
}
