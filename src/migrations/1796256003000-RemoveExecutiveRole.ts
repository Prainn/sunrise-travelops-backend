import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveExecutiveRole1796256003000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        -- EXECUTIVE overrides ADMIN with read-only access. Do not promote mixed accounts implicitly.
        IF EXISTS (
          SELECT 1
          FROM identity_roles ir
          JOIN user_identities i ON i.id=ir.identity_id
          JOIN roles r ON r.id=ir.role_id
          JOIN identity_roles ar ON ar.identity_id=i.id
          JOIN roles a ON a.id=ar.role_id
          WHERE i.scope='headquarters'
            AND r.code='EXECUTIVE' AND r.is_enabled
            AND a.code='ADMIN' AND a.is_enabled
        ) THEN
          RAISE EXCEPTION 'Resolve mixed headquarters EXECUTIVE and ADMIN identities before removing EXECUTIVE';
        END IF;
      END $$;

      DELETE FROM role_menu_configs c USING roles r
      WHERE c.role_id=r.id AND r.code='EXECUTIVE';
      DELETE FROM identity_roles ir USING roles r
      WHERE ir.role_id=r.id AND r.code='EXECUTIVE';
      DELETE FROM roles WHERE code='EXECUTIVE';
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Restore the pre-migration backup to recover the removed role and its assignments',
      ),
    );
  }
}
