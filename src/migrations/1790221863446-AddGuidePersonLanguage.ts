import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuidePersonLanguage1790221863446 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "resource_guide_people" ADD COLUMN "language" text',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "resource_guide_people" DROP COLUMN "language"',
    );
  }
}
