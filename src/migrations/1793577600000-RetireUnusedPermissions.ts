import { MigrationInterface, QueryRunner } from 'typeorm';

// Freeze retired codes here; historical migrations and runtime grants may differ.
const retired = [
  'sys:role:list',
  'sys:role:create',
  'sys:role:update',
  'sys:role:delete',
  'sys:user:import',
  'sys:user:export',
];

/** Preserve exact permission IDs/names and existing role links for rollback. */
export class RetireUnusedPermissions1793577600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS retired_permissions_backup (
      id uuid PRIMARY KEY, code varchar(100) NOT NULL UNIQUE,
      name varchar(150) NOT NULL, role_ids uuid[] NOT NULL
    )`);
    await q.query(
      `INSERT INTO retired_permissions_backup (id, code, name, role_ids)
       SELECT p.id, p.code, p.name,
         ARRAY(SELECT rp.role_id FROM role_permissions rp WHERE rp.permission_id=p.id ORDER BY rp.role_id)
       FROM permissions p WHERE p.code=ANY($1::text[])
       ON CONFLICT (code) DO NOTHING`,
      [retired],
    );
    // FK cascade removes only links belonging to the six retired permissions.
    await q.query('DELETE FROM permissions WHERE code=ANY($1::text[])', [
      retired,
    ]);
  }

  async down(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('retired_permissions_backup'))) return;
    await q.query(`INSERT INTO permissions (id,code,name)
      SELECT id,code,name FROM retired_permissions_backup
      ON CONFLICT (code) DO NOTHING`);
    await q.query(`INSERT INTO role_permissions (role_id,permission_id)
      SELECT r.id,p.id FROM retired_permissions_backup b
      JOIN permissions p ON p.code=b.code
      CROSS JOIN LATERAL unnest(b.role_ids) AS saved(role_id)
      JOIN roles r ON r.id=saved.role_id
      ON CONFLICT DO NOTHING`);
    await q.query('DROP TABLE retired_permissions_backup');
  }
}
