import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebsiteVisitLedger1792972800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE website_inquiries
      ADD COLUMN received_at timestamp without time zone,
      ALTER COLUMN landing_page TYPE varchar(2048),
      ALTER COLUMN acquisition_source TYPE varchar(2048);
      UPDATE website_inquiries SET received_at = received_date + COALESCE(NULLIF(received_time,'')::time, '00:00'::time) WHERE received_date IS NOT NULL;
      ALTER TABLE website_inquiries DROP COLUMN received_date, DROP COLUMN received_time;
      CREATE TABLE website_visit_inquiries (
        visit_id uuid PRIMARY KEY,
        inquiry_id uuid NOT NULL UNIQUE REFERENCES website_inquiries(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO permissions(code,name) VALUES
        ('website:visit:list','查看独立站访问记录'),
        ('website:visit:export','导出独立站访问记录');
      UPDATE role_menu_configs SET menu_keys=array_append(menu_keys,'website-visits'), version=version+1,updated_at=now()
      WHERE role_id IN (SELECT id FROM roles WHERE code IN ('ROOT','ADMIN','EXECUTIVE','BUSINESS_MANAGER','COORDINATOR'))
        AND NOT ('website-visits'=ANY(menu_keys));`);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Received time consolidation is irreversible; restore the pre-migration backup with the matching application.',
      ),
    );
  }
}
