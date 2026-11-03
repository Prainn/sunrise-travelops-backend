import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebsiteVisitConfirmations1795392000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE website_visit_confirmations (
      visit_id uuid PRIMARY KEY
    )`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Keep visit confirmations when rolling back the application; dropping this table would discard confirmation marks.',
      ),
    );
  }
}
