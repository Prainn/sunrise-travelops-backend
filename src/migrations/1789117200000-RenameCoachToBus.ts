import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameCoachToBus1789117200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE system_business_dictionary_items
      SET name = '巴士', version = version + 1, updated_at = now()
      WHERE code = 'coach' AND name = '旅游大巴'
    `);
    await queryRunner.query(`
      UPDATE resource_transports
      SET name = replace(name, '旅游大巴', '巴士'),
          version = version + 1, updated_at = now()
      WHERE name LIKE '%旅游大巴%'
    `);
  }

  async down(): Promise<void> {
    // Terminology remains valid for older applications; preserve resource names.
  }
}
