import { MigrationInterface, QueryRunner } from 'typeorm';

export class KeyShengxuLedgersByContact1794096000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Retain the constraint identity so the previous app still maps duplicates to 409.
    await q.query(`ALTER TABLE shengxu_ledgers
      DROP CONSTRAINT uq_shengxu_ledger_date_agency,
      ADD CONSTRAINT uq_shengxu_ledger_date_agency
        UNIQUE(record_date,agency_id,contact_id)`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Different contacts may share a date and agency; retain records and use a reviewed recovery plan',
      ),
    );
  }
}
