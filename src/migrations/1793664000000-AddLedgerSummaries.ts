import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLedgerSummaries1793664000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE ledger_summary_notes (
      report_key text NOT NULL CHECK(report_key IN ('shengxu-agency-summary','shengxu-coordinator-summary','linxi-quote-summary','website-quote-summary')),
      row_id uuid NOT NULL,
      first_follow_up text NOT NULL DEFAULT '' CHECK(length(first_follow_up)<=2000),
      tour_numbers text NOT NULL DEFAULT '' CHECK(length(tour_numbers)<=5000),
      version integer NOT NULL DEFAULT 1 CHECK(version>0),
      updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(report_key,row_id),
      CHECK(report_key='shengxu-agency-summary' OR first_follow_up='')
    );
    INSERT INTO permissions(code,name) VALUES
      ('ledger:summary:list','查看台账汇总'),('ledger:summary:update','修改台账汇总补充资料') ON CONFLICT(code) DO NOTHING;
    INSERT INTO role_permissions(role_id,permission_id)
      SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
      WHERE (p.code='ledger:summary:list' AND r.code IN ('ROOT','ADMIN','EXECUTIVE','BUSINESS_MANAGER','COORDINATOR','RESOURCE_MANAGER'))
        OR (p.code='ledger:summary:update' AND r.code='BUSINESS_MANAGER') ON CONFLICT DO NOTHING;`);
    const all = [
      'shengxu-agency-summary',
      'shengxu-coordinator-summary',
      'linxi-quote-summary',
      'linxi-platform-summary',
      'website-quote-summary',
      'website-platform-summary',
    ];
    for (const role of [
      'ROOT',
      'ADMIN',
      'EXECUTIVE',
      'BUSINESS_MANAGER',
      'COORDINATOR',
    ]) {
      const defaults = role === 'COORDINATOR' ? all.slice(0, 2) : all;
      await q.query(
        `UPDATE role_menu_configs c
        SET menu_keys=c.menu_keys || ARRAY(SELECT key FROM unnest($2::text[]) AS key WHERE NOT(key=ANY(c.menu_keys))),
          version=version+1,updated_at=now()
        FROM roles r WHERE r.id=c.role_id AND r.code=$1`,
        [role, defaults],
      );
    }
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Summary notes contain business input; retain data and use a reviewed recovery plan',
      ),
    );
  }
}
