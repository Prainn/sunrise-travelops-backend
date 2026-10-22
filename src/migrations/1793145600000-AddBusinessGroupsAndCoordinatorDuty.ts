import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessGroupsAndCoordinatorDuty1793145600000 implements MigrationInterface {
  name = 'AddBusinessGroupsAndCoordinatorDuty1793145600000';
  async up(q: QueryRunner): Promise<void> {
    // Historical ledger deletion is a separately authorized, backed-up operation.
    // Refuse to reinterpret user UUIDs as group UUIDs or delete business data here.
    await q.query(`LOCK TABLE direct_ledgers IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM direct_ledgers) THEN
          RAISE EXCEPTION 'Clear the explicitly authorized historical direct ledgers under the maintenance plan before this migration';
        END IF;
      END $$;
      CREATE TABLE business_groups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(100) NOT NULL CHECK(length(btrim(name)) > 0),
        status text NOT NULL DEFAULT 'enabled' CHECK(status IN ('enabled','disabled')),
        version integer NOT NULL DEFAULT 1 CHECK(version > 0),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid REFERENCES users(id), updated_by uuid REFERENCES users(id),
        CONSTRAINT uq_business_groups_name UNIQUE(name)
      );
      INSERT INTO business_groups(name) VALUES ('定制师杨娟组'),('定制师陈勇组'),('定制师尹卉组'),('定制师常胜组'),('定制师李纲组');
      ALTER TABLE user_identities
        ADD COLUMN coordinator_duty text CHECK(coordinator_duty IN ('reception','operation','both')),
        ADD COLUMN business_group_id uuid REFERENCES business_groups(id),
        ADD CONSTRAINT ck_identity_business_group_scope CHECK(business_group_id IS NULL OR scope='linxi');
      UPDATE user_identities i SET coordinator_duty='reception'
        WHERE EXISTS(SELECT 1 FROM identity_roles ir JOIN roles r ON r.id=ir.role_id WHERE ir.identity_id=i.id AND r.code='COORDINATOR');
      WITH assignments(nickname,group_name) AS (VALUES
        ('罗露露','定制师杨娟组'),('裴怡菲','定制师杨娟组'),('李璐','定制师杨娟组'),('李紫涵','定制师杨娟组'),
        ('陈勇','定制师陈勇组'),('李昊霖','定制师陈勇组'),
        ('尹卉','定制师尹卉组'),('农廷婷','定制师尹卉组'),('张奥岚','定制师尹卉组'),('杨文美','定制师尹卉组'),
        ('常胜','定制师常胜组'),('郑赫','定制师常胜组'),('王煜然','定制师常胜组')
      ), matched AS (
        SELECT i.id,g.id AS group_id,count(*) OVER(PARTITION BY a.nickname) AS matches
        FROM assignments a JOIN users u ON u.nickname=a.nickname AND u.deleted_at IS NULL AND NOT u.is_superuser
        JOIN user_identities i ON i.user_id=u.id AND i.scope='linxi'
        JOIN business_groups g ON g.name=a.group_name
        WHERE NOT EXISTS(SELECT 1 FROM user_identities other WHERE other.user_id=u.id AND other.scope<>'linxi')
      ) UPDATE user_identities i SET business_group_id=m.group_id FROM matched m WHERE m.id=i.id AND m.matches=1;
      CREATE INDEX idx_identity_business_group ON user_identities(business_group_id) WHERE business_group_id IS NOT NULL;
      ALTER TABLE direct_ledgers DROP CONSTRAINT direct_ledgers_receiving_account_id_fkey;
      ALTER TABLE direct_ledgers RENAME COLUMN receiving_account_id TO receiving_group_id;
      ALTER TABLE direct_ledgers ADD CONSTRAINT fk_direct_ledger_receiving_group FOREIGN KEY(receiving_group_id) REFERENCES business_groups(id);
      UPDATE role_menu_configs c SET menu_keys=array_append(c.menu_keys,'business-groups'),version=version+1,updated_at=now()
        FROM roles r WHERE r.id=c.role_id AND r.code IN ('ROOT','ADMIN','EXECUTIVE','BUSINESS_MANAGER')
        AND NOT ('business-groups'=ANY(c.menu_keys));
    `);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Business groups and coordinator duties require a reviewed database and application recovery plan',
      ),
    );
  }
}
