import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOperationLogs1790157000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE operation_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      time timestamptz NOT NULL DEFAULT now(),
      category varchar(32) NOT NULL,
      action varchar(80) NOT NULL,
      success boolean NOT NULL,
      actor_id uuid,
      actor_name varchar(80) NOT NULL,
      scope varchar(32),
      detail text NOT NULL DEFAULT '{}',
      ip varchar(64)
    )`);
    await queryRunner.query(
      'CREATE INDEX IDX_operation_logs_time ON operation_logs (time DESC, id DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX IDX_operation_logs_category_time ON operation_logs (category, time DESC, id DESC)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE operation_logs');
  }
}
