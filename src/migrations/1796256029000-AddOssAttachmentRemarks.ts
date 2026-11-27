import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOssAttachmentRemarks1796256029000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE oss_attachment_remarks (
        environment text NOT NULL CHECK (environment IN ('dev','prod')),
        source text NOT NULL CHECK (source IN ('mail','whatsapp','upload')),
        attachment_id uuid NOT NULL,
        remark varchar(1000) NOT NULL,
        version integer NOT NULL CHECK (version >= 2),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (environment, source, attachment_id)
      )
    `);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE oss_attachment_remarks');
  }
}
