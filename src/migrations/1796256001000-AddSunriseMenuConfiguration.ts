import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSunriseMenuConfiguration1796256001000 implements MigrationInterface {
  name = 'AddSunriseMenuConfiguration1796256001000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE account_menu_configs (
      username varchar(80) PRIMARY KEY CHECK(username='sunrise'),
      menu_keys text[] NOT NULL,
      version integer NOT NULL CHECK(version>=2),
      updated_by uuid REFERENCES users(id),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE account_menu_configs');
  }
}
