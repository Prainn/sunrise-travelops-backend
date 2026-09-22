import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddResourceDescriptions1790060715835 implements MigrationInterface {
  name = 'AddResourceDescriptions1790060715835';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE resource_attractions ADD COLUMN description text NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE resource_restaurants ADD COLUMN description text NOT NULL DEFAULT ''`,
    );
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Retain resource descriptions when rolling back the application',
      ),
    );
  }
}
