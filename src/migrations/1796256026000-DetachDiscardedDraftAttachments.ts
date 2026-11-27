import { MigrationInterface, QueryRunner } from 'typeorm';

export class DetachDiscardedDraftAttachments1796256026000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE mail_attachments ALTER COLUMN message_id DROP NOT NULL,
        ADD CONSTRAINT mail_attachment_owner_or_removed CHECK (message_id IS NOT NULL OR removed_at IS NOT NULL);
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    // A pending OSS removal must finish before restoring the required parent.
    await runner.query(`
      ALTER TABLE mail_attachments ALTER COLUMN message_id SET NOT NULL,
        DROP CONSTRAINT mail_attachment_owner_or_removed;
    `);
  }
}
