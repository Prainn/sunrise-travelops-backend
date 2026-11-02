import { MigrationInterface, QueryRunner } from 'typeorm';

export class LinkDirectLedgerTours1795305600000 implements MigrationInterface {
  name = 'LinkDirectLedgerTours1795305600000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE direct_ledgers
      ADD COLUMN country_item_id uuid REFERENCES system_business_dictionary_items(id),
      ADD COLUMN country_code text,
      ADD COLUMN country_name text,
      ADD CONSTRAINT chk_direct_ledger_country CHECK (
        (country_item_id IS NULL AND country_code IS NULL AND country_name IS NULL) OR
        (country_item_id IS NOT NULL AND country_code IS NOT NULL AND country_name IS NOT NULL)),
      ADD CONSTRAINT uq_direct_ledger_id_unit UNIQUE(id,business_unit);
      ALTER TABLE tours ADD COLUMN direct_ledger_id uuid,
      ADD CONSTRAINT fk_tours_direct_ledger FOREIGN KEY(direct_ledger_id,business_unit)
        REFERENCES direct_ledgers(id,business_unit),
      ADD CONSTRAINT chk_tours_direct_ledger_source CHECK (
        direct_ledger_id IS NULL OR (source_module='manual' AND business_unit IN ('linxi','website')));
      CREATE UNIQUE INDEX uq_tours_active_direct_ledger ON tours(direct_ledger_id)
        WHERE direct_ledger_id IS NOT NULL AND status='active';
      CREATE INDEX ix_tours_direct_ledger_history ON tours(direct_ledger_id,created_at DESC,id)
        WHERE direct_ledger_id IS NOT NULL;`);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Retain direct ledger country snapshots and tour links; use a reviewed recovery plan',
      ),
    );
  }
}
