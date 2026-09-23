import { MigrationInterface, QueryRunner } from 'typeorm';

export class MarkProvinceBusinessCategoryBuiltIn1790147047000 implements MigrationInterface {
  name = 'MarkProvinceBusinessCategoryBuiltIn1790147047000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "system_business_dictionary_types" SET "is_built_in" = true WHERE "code" = 'province' AND "is_built_in" = false`,
    );
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Retain built-in category protection when rolling back the application',
      ),
    );
  }
}
