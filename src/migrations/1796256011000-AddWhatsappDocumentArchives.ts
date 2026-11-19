import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsappDocumentArchives1796256011000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE whatsapp_document_archives (
        message_id uuid NOT NULL REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
        environment text NOT NULL CHECK (environment IN ('dev','prod')),
        state text NOT NULL DEFAULT 'pending'
          CHECK (state IN ('pending','processing','available','failed','skipped')),
        attempts integer NOT NULL DEFAULT 0,
        max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts IN (1,5)),
        available_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        error_code text,
        extension text CHECK (extension IN ('pdf','doc','docx')),
        file_name text,
        size_bytes integer CHECK (size_bytes BETWEEN 1 AND 20971520),
        PRIMARY KEY (message_id, environment),
        CHECK (attempts BETWEEN 0 AND max_attempts),
        CHECK (state <> 'available' OR (extension IS NOT NULL AND file_name IS NOT NULL AND size_bytes IS NOT NULL))
      );
      CREATE INDEX whatsapp_document_archives_queue ON whatsapp_document_archives
        (environment, max_attempts DESC, available_at) WHERE state IN ('pending','processing');
      CREATE INDEX whatsapp_inbound_documents_discovery ON whatsapp_messages (seq DESC)
        WHERE kind='document' AND direction='inbound' AND source='customer';
    `);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query(
      'DROP INDEX whatsapp_inbound_documents_discovery; DROP TABLE whatsapp_document_archives',
    );
  }
}
