import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMailRuntimeSettings1796256027000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE mail_runtime_settings (
        id smallint PRIMARY KEY CHECK (id=1),
        inbound_enabled boolean NOT NULL DEFAULT true,
        outbound_enabled boolean NOT NULL DEFAULT true,
        version integer NOT NULL DEFAULT 1 CHECK (version>0)
      );
      INSERT INTO mail_runtime_settings(id) VALUES(1);
      ALTER TABLE mail_sync
        ADD COLUMN last_started_at timestamptz,
        ADD COLUMN last_completed_at timestamptz,
        ADD COLUMN last_error_at timestamptz;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE mail_sync DROP COLUMN last_started_at, DROP COLUMN last_completed_at, DROP COLUMN last_error_at;
      DROP TABLE mail_runtime_settings;
    `);
  }
}
