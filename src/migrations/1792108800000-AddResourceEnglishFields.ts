import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddResourceEnglishFields1792108800000 implements MigrationInterface {
  name = 'AddResourceEnglishFields1792108800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE resource_hotels ADD COLUMN english_name varchar(150) NOT NULL DEFAULT '';
      ALTER TABLE resource_restaurants
        ADD COLUMN english_name varchar(150) NOT NULL DEFAULT '',
        ADD COLUMN english_description text NOT NULL DEFAULT '';
      ALTER TABLE resource_attractions
        ADD COLUMN english_name varchar(150) NOT NULL DEFAULT '',
        ADD COLUMN english_description text NOT NULL DEFAULT '';
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Retain resource English fields when rolling back the application',
      ),
    );
  }
}
