import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUnknownCountryRegion1792540800000 implements MigrationInterface {
  name = 'AddUnknownCountryRegion1792540800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE inquiries ALTER COLUMN country_code TYPE varchar(7);
      ALTER TABLE website_inquiries ALTER COLUMN country_code TYPE varchar(7);
      ALTER TABLE tours ALTER COLUMN country_code TYPE varchar(7)`);

    // Freeze the reserved option here; deployed migrations do not import catalogs.
    await q.query(`INSERT INTO system_business_dictionary_items
      (type_id, code, name, english_name, status)
      SELECT id, 'UNKNOWN', '未知/待确认', 'Unknown / To be confirmed', 'enabled'
      FROM system_business_dictionary_types
      WHERE code='country-region' AND deleted_at IS NULL
      ON CONFLICT (type_id, code) DO NOTHING`);
    await q.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM system_business_dictionary_items i
        JOIN system_business_dictionary_types t ON t.id=i.type_id
        WHERE t.code='country-region' AND t.deleted_at IS NULL
          AND i.code='UNKNOWN' AND i.name='未知/待确认'
          AND i.english_name='Unknown / To be confirmed'
          AND i.status='enabled' AND i.deleted_at IS NULL
          AND i.resource_types='{}'::text[]
      ) THEN
        RAISE EXCEPTION 'UNKNOWN country option is missing or conflicts with an existing item';
      END IF;
    END $$`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'UNKNOWN may be referenced by business records; retain the option and code width during application rollback',
      ),
    );
  }
}
