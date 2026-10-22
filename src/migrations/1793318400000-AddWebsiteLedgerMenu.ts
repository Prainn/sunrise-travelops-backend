import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebsiteLedgerMenu1793318400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE role_menu_configs
      SET menu_keys=array_append(menu_keys,'website-ledger'),version=version+1,updated_at=now()
      WHERE role_id IN (SELECT id FROM roles WHERE code IN ('ROOT','ADMIN','EXECUTIVE','BUSINESS_MANAGER','COORDINATOR'))
        AND 'direct-ledger'=ANY(menu_keys) AND NOT ('website-ledger'=ANY(menu_keys))`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE role_menu_configs
      SET menu_keys=array_remove(menu_keys,'website-ledger'),version=version+1,updated_at=now()
      WHERE 'website-ledger'=ANY(menu_keys)`);
  }
}
