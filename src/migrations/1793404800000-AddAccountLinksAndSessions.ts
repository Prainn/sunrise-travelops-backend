import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountLinksAndSessions1793404800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE account_link_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer NOT NULL DEFAULT 1 CHECK(version>0),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid REFERENCES users(id), updated_by uuid REFERENCES users(id)
    );
    ALTER TABLE users ADD COLUMN account_link_id uuid REFERENCES account_link_groups(id);
    CREATE INDEX users_account_link ON users(account_link_id) WHERE account_link_id IS NOT NULL;
    CREATE TABLE auth_account_sessions (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
      identity_id uuid NOT NULL REFERENCES user_identities(id) ON DELETE CASCADE,
      version integer NOT NULL DEFAULT 1 CHECK(version>0), refresh_token_hash text NOT NULL,
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX auth_account_sessions_user ON auth_account_sessions(user_id);
    INSERT INTO permissions(code,name) VALUES('sys:account-link:manage','管理账号关联') ON CONFLICT(code) DO NOTHING;
    INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code IN ('ROOT','ADMIN') AND p.code='sys:account-link:manage' ON CONFLICT DO NOTHING;
    UPDATE role_menu_configs SET menu_keys=array_append(menu_keys,'account-links'),version=version+1,updated_at=now()
    WHERE role_id IN (SELECT id FROM roles WHERE code IN ('ROOT','ADMIN')) AND NOT ('account-links'=ANY(menu_keys));`);
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = (await q.query(
      `SELECT EXISTS(SELECT 1 FROM account_link_groups) AS exists`,
    )) as { exists: boolean }[];
    if (row.exists)
      throw new Error(
        'Account links exist; use an approved restore plan instead of discarding relationships.',
      );
    await q.query(`DROP TABLE auth_account_sessions;
      DROP INDEX users_account_link;
      ALTER TABLE users DROP COLUMN account_link_id;
      DROP TABLE account_link_groups;
      UPDATE role_menu_configs SET menu_keys=array_remove(menu_keys,'account-links'),version=version+1,updated_at=now() WHERE 'account-links'=ANY(menu_keys);
      DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code='sys:account-link:manage');
      DELETE FROM permissions WHERE code='sys:account-link:manage';`);
  }
}
