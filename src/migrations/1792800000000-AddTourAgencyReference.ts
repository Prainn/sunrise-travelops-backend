import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTourAgencyReference1792800000000 implements MigrationInterface {
  name = 'AddTourAgencyReference1792800000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE tours ADD COLUMN agency_id uuid REFERENCES resource_agencies(id)`,
    );
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Retain tour agency references; rollback requires a reviewed data recovery plan',
      ),
    );
  }
}
