import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHeadquartersBossRole1796256002000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO roles(code, name) VALUES ('BOSS', '老板');
      INSERT INTO role_menu_configs(role_id, menu_keys)
      SELECT id, ARRAY[]::text[] FROM roles WHERE code='BOSS';
      UPDATE identity_roles ir SET role_id=boss.id
      FROM user_identities i
      JOIN users u ON u.id=i.user_id
      CROSS JOIN roles root
      CROSS JOIN roles boss
      WHERE ir.identity_id=i.id AND ir.role_id=root.id
        AND root.code='ROOT' AND boss.code='BOSS'
        AND i.scope='headquarters' AND u.username='sunrise'
        AND u.deleted_at IS NULL;
      UPDATE departments SET name='老板' WHERE id=4 AND scope='headquarters';
      UPDATE user_identities i SET dept_id=4
      FROM users u
      WHERE u.id=i.user_id AND u.username='sunrise' AND u.deleted_at IS NULL
        AND i.scope='headquarters' AND EXISTS (
          SELECT 1 FROM identity_roles ir JOIN roles r ON r.id=ir.role_id
          WHERE ir.identity_id=i.id AND r.code='BOSS'
        );
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Restoring the ROOT role would restore removed permissions'),
    );
  }
}
