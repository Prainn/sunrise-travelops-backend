import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitializeProvinceDictionary1790265600000 implements MigrationInterface {
  name = 'InitializeProvinceDictionary1790265600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO system_business_dictionary_types
        (name, english_name, code, is_built_in)
      VALUES ('省份', 'Province', 'province', true)
      ON CONFLICT (code) DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO system_business_dictionary_items
        (type_id, code, name, english_name, resource_types, status, remark)
      SELECT id, 'yunnan', '云南', 'Yunnan', ARRAY[]::text[], 'enabled', ''
      FROM system_business_dictionary_types WHERE code = 'province'
      ON CONFLICT (type_id, code) DO NOTHING
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Province initialization is retained on application rollback.'),
    );
  }
}
