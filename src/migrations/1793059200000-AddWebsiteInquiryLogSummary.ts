import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebsiteInquiryLogSummary1793059200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE website_logs
      ADD COLUMN inquiry_code text,
      ADD COLUMN operator_username varchar(100),
      ADD COLUMN target_type varchar(20) CHECK(target_type IN ('inquiry','itinerary')),
      ADD COLUMN target_code text,
      ADD COLUMN summary text,
      ADD COLUMN changes jsonb CHECK(changes IS NULL OR jsonb_typeof(changes)='array'),
      ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object');
      CREATE INDEX website_logs_time ON website_logs(occurred_at DESC,id DESC);
      UPDATE role_menu_configs SET menu_keys=array_append(menu_keys,'website-inquiry-summary'),version=version+1,updated_at=now()
      WHERE role_id IN (SELECT id FROM roles WHERE code IN ('ROOT','ADMIN','EXECUTIVE','BUSINESS_MANAGER','COORDINATOR'))
        AND 'inquiries'=ANY(menu_keys) AND NOT ('website-inquiry-summary'=ANY(menu_keys));`);
  }

  async down(q: QueryRunner): Promise<void> {
    const [row] = (await q.query(
      'SELECT count(*)::text AS count FROM website_logs WHERE changes IS NOT NULL',
    )) as { count: string }[];
    if (Number(row.count))
      throw new Error(
        'Cannot discard website field audit history; restore an approved backup instead.',
      );
    await q.query(`UPDATE role_menu_configs SET menu_keys=array_remove(menu_keys,'website-inquiry-summary'),version=version+1,updated_at=now()
      WHERE 'website-inquiry-summary'=ANY(menu_keys);
      DROP INDEX website_logs_time;
      ALTER TABLE website_logs DROP COLUMN inquiry_code,DROP COLUMN operator_username,
        DROP COLUMN target_type,DROP COLUMN target_code,DROP COLUMN summary,DROP COLUMN changes,DROP COLUMN metadata;`);
  }
}
