import type { MigrationInterface, QueryRunner } from 'typeorm';

export class IncreaseOssManagementImageSize1796256030000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE oss_resources
        DROP CONSTRAINT oss_resources_size_check,
        ADD CONSTRAINT oss_resources_size_check CHECK (
          size > 0 AND size <= CASE WHEN source='management' THEN 10485760 ELSE 5242880 END
        )
    `);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query(`
      ALTER TABLE oss_resources
        DROP CONSTRAINT oss_resources_size_check,
        ADD CONSTRAINT oss_resources_size_check CHECK (size > 0 AND size <= 5242880)
    `);
  }
}
