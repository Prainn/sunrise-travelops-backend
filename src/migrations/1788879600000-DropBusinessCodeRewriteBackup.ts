import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropBusinessCodeRewriteBackup1788879600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS business_code_rewrites');
  }

  async down(): Promise<void> {
    // Cleanup is permanent; do not recreate a migration-only table on rollback.
  }
}
