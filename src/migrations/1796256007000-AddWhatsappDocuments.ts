import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsappDocuments1796256007000 implements MigrationInterface {
  name = 'AddWhatsappDocuments1796256007000';

  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE whatsapp_documents (
        id uuid PRIMARY KEY,
        conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id),
        actor_identity_id uuid NOT NULL REFERENCES user_identities(id),
        file_name text NOT NULL,
        extension text NOT NULL CHECK(extension IN ('pdf','doc','docx')),
        mime_type text NOT NULL,
        size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 20971520),
        state text NOT NULL CHECK(state IN ('uploading','ready','deleting')),
        uploaded_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        claimed_at timestamptz
      );
      CREATE INDEX whatsapp_documents_cleanup_idx ON whatsapp_documents (uploaded_at)
        WHERE claimed_at IS NULL;
    `);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE whatsapp_documents');
  }
}
