/** Real HTTP/JWT and disposable localhost PostgreSQL; never reads business DB settings. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Actor, IsolationHarness, Page } from './business-isolation.harness';
import { SummaryRow } from '../src/ledgers/ledger-summaries.service';
import {
  SUMMARY_REPORTS,
  SummaryReport,
} from '../src/ledgers/ledger-summaries.dto';
import { AddLedgerSummaries1793664000000 } from '../src/migrations/1793664000000-AddLedgerSummaries';
import { MenuPermissionsService } from '../src/roles/menu-permissions.service';
import { MENU_GROUPS } from '../src/roles/menu-definitions';

const h = new IsolationHarness();
const path = (report: SummaryReport) => `/ledgers/summaries/${report}`;
async function list(actor: Actor, report: SummaryReport, query = '') {
  return h.call<Page<SummaryRow>>(actor, 'GET', path(report) + query);
}
async function deny(
  actor: Actor | undefined,
  method: string,
  url: string,
  body?: unknown,
  status = 403,
  code = 'AUTH_FORBIDDEN',
) {
  const before = await h.db.query<unknown[]>(
    'SELECT * FROM ledger_summary_notes ORDER BY report_key,row_id',
  );
  await h.unchanged(async () => {
    await h.call(actor, method, url, body, status, code);
  });
  assert.deepEqual(
    await h.db.query(
      'SELECT * FROM ledger_summary_notes ORDER BY report_key,row_id',
    ),
    before,
  );
}
async function run() {
  try {
    await h.start();
    assert.deepEqual(await h.db.runMigrations(), []);
    const root = await h.actor('headquarters', 'ROOT');
    const admin = await h.actor('headquarters', 'ADMIN');
    const executive = await h.actor('headquarters', 'EXECUTIVE');
    const sx = await h.actor('shengxu');
    const sx2 = await h.actor('shengxu');
    const sxManager = await h.actor('shengxu', 'BUSINESS_MANAGER');
    const lx = await h.actor('linxi');
    const lxManager = await h.actor('linxi', 'BUSINESS_MANAGER');
    // Same user ID in another identity must not merge business totals or notes.
    const web = await h.actor('website', 'COORDINATOR', 'both', lx.id);
    const webManager = await h.actor('website', 'BUSINESS_MANAGER');
    const resource = await h.actor('linxi', 'RESOURCE_MANAGER');
    const [agency, agency2, contact, contact2, group, red, douyin] = Array.from(
      { length: 7 },
      () => randomUUID(),
    );
    for (const [id, owner, name] of [
      [agency, sx.id, 'Agency A'],
      [agency2, sx2.id, 'Agency B'],
    ]) {
      await h.db.query(
        `INSERT INTO resource_agencies(id,code,name,business_unit,coordinator_id,country_or_region,city)
        VALUES($1,next_business_code('AGY'),$2,'shengxu',$3,'CN','City')`,
        [id, name, owner],
      );
    }
    for (const [id, aid] of [
      [contact, agency],
      [contact2, agency2],
    ]) {
      await h.db.query(
        `INSERT INTO resource_agency_contacts(id,agency_id,name,name_key) VALUES($1,$2,'Contact','contact')`,
        [id, aid],
      );
    }
    for (const [id, name] of [
      [group, 'Designer group'],
      [red, 'Red group'],
      [douyin, 'Douyin group'],
    ]) {
      await h.db.query('INSERT INTO business_groups(id,name) VALUES($1,$2)', [
        id,
        name,
      ]);
    }
    for (const [date, aid, cid, owner, name, quotes, converted, reason] of [
      ['2026-10-01', agency, contact, sx.id, 'Agency old', 5, 2, 'Reason one'],
      ['2026-10-02', agency, contact, sx.id, 'Agency A', 7, 0, 'Reason two'],
      ['2026-11-01', agency, contact, sx2.id, 'Agency renamed', 11, 1, ''],
      ['2026-10-01', agency2, contact2, sx2.id, 'Agency B', 1, 0, ''],
    ]) {
      await h.db.query(
        `INSERT INTO shengxu_ledgers(record_date,creator_id,creator_name,agency_id,agency_name,country_or_region,city,
        contact_id,contact_name,quoted_groups,converted_groups,not_converted_reason,updated_by)
        VALUES($1,$2,$3,$4,$5,'CN','City',$6,'Contact',$7,$8,$9,$2)`,
        [
          date,
          owner,
          owner === sx.id ? 'Reception A' : 'Reception B',
          aid,
          name,
          cid,
          quotes,
          converted,
          reason,
        ],
      );
    }
    for (const [unit, owner] of [
      ['linxi', lx.id],
      ['website', web.id],
    ]) {
      for (const [date, sent, status, reason, gid, gname] of [
        [
          '2026-10-01',
          true,
          'unconverted',
          'Direct reason one',
          group,
          'Designer old',
        ],
        [
          '2026-10-02',
          false,
          'converted',
          'Direct reason two',
          group,
          'Designer group',
        ],
        ['2026-11-01', true, 'converted', '', red, 'Red group'],
        ['2026-11-02', true, 'unconverted', '', douyin, 'Douyin group'],
      ]) {
        await h.db.query(
          `INSERT INTO direct_ledgers(business_unit,received_date,source,creator_id,creator_name,receiving_group_id,
          receiving_account_name,operator_id,operator_name,proposal_sent,order_status,not_converted_reason,updated_by)
          VALUES($1,$2,'Customer',$3,'Reception',$4,$5,$3,'Operator',$6,$7,$8,$3)`,
          [
            unit,
            date,
            owner,
            unit === 'linxi' ? gid : null,
            unit === 'linxi' ? gname : '独立站',
            sent,
            status,
            reason,
          ],
        );
      }
    }
    // Reconstruct the pre-migration schema with representative rows, then upgrade.
    // Only the new empty table/catalog/menu additions are removed in this disposable DB.
    const allBefore = await h.db.query<
      unknown[]
    >(`SELECT (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM shengxu_ledgers s) AS sx,
      (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM direct_ledgers d) AS direct`);
    await h.db.query(`DROP TABLE ledger_summary_notes;
      DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code LIKE 'ledger:summary:%');
      DELETE FROM permissions WHERE code LIKE 'ledger:summary:%';`);
    await h.db.query(
      'UPDATE role_menu_configs SET menu_keys=ARRAY(SELECT k FROM unnest(menu_keys) k WHERE k<>ALL($1::text[]))',
      [SUMMARY_REPORTS],
    );
    const q = h.db.createQueryRunner();
    try {
      await new AddLedgerSummaries1793664000000().up(q);
    } finally {
      await q.release();
    }
    assert.deepEqual(
      await h.db
        .query(`SELECT (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM shengxu_ledgers s) AS sx,
      (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM direct_ledgers d) AS direct`),
      allBefore,
    );
    const menus = new MenuPermissionsService(h.db);
    for (const unit of ['shengxu', 'linxi', 'website'] as const) {
      const expected = SUMMARY_REPORTS.filter((key) =>
        key.startsWith(unit + '-'),
      );
      assert.deepEqual(
        (await menus.snapshot(unit, ['BUSINESS_MANAGER']))
          .filter(
            (key) =>
              key.includes('summary') &&
              SUMMARY_REPORTS.includes(key as SummaryReport),
          )
          .sort(),
        [...expected].sort(),
      );
      assert.deepEqual(
        (await menus.snapshot(unit, ['COORDINATOR']))
          .filter((key) => SUMMARY_REPORTS.includes(key as SummaryReport))
          .sort(),
        unit === 'shengxu' ? [...expected].sort() : [],
      );
      assert.deepEqual(
        (await menus.snapshot(unit, ['RESOURCE_MANAGER'])).filter((key) =>
          SUMMARY_REPORTS.includes(key as SummaryReport),
        ),
        [],
      );
    }
    const dataGroup = MENU_GROUPS.find((g) => g.key === 'data-ledgers')!;
    assert.equal(dataGroup.children.at(-1)?.menuKey, 'website-visits');
    for (const actor of [root, admin, executive]) {
      for (const report of SUMMARY_REPORTS) {
        const result = await list(actor, report);
        assert.ok(result.total > 0);
      }
    }
    const agencyAll = await list(sx, 'shengxu-agency-summary');
    assert.equal(agencyAll.total, 2);
    const a = agencyAll.list.find((row) => row.id === agency)!;
    assert.equal(a.quotedCount, 23);
    assert.equal(a.convertedCount, 3);
    assert.equal(a.name, 'Agency renamed');
    const october = await list(
      sxManager,
      'shengxu-agency-summary',
      '?from=2026-10-01&to=2026-10-02&keyword=Agency%20A',
    );
    assert.equal(october.total, 1);
    assert.equal(october.list[0].quotedCount, 12);
    assert.equal(october.list[0].convertedCount, 2);
    assert.equal(october.list[0].name, 'Agency A');
    assert.equal(
      (await list(sx, 'shengxu-agency-summary', '?from=2026-12-01')).total,
      0,
    );
    const paged = await list(sx, 'shengxu-agency-summary', '?pageSize=1');
    assert.equal(paged.total, 2);
    assert.equal(paged.list.length, 1);
    const next = await list(sx, 'shengxu-agency-summary', '?pageSize=1&page=2');
    assert.notEqual(paged.list[0].id, next.list[0].id);
    const person = (
      await list(sxManager, 'shengxu-coordinator-summary')
    ).list.find((r) => r.id === sx.id)!;
    assert.equal(person.quotedCount, 12);
    assert.equal(person.convertedCount, 2);
    const direct = (await list(lxManager, 'linxi-quote-summary')).list[0];
    assert.equal(direct.quotedCount, 3);
    assert.equal(direct.convertedCount, 2);
    const platform = await list(lxManager, 'linxi-platform-summary');
    assert.equal(platform.total, 3);
    const designer = platform.list.find((r) => r.id === group)!;
    assert.equal(designer.name, 'Designer group');
    assert.equal(designer.quotedCount, 1);
    assert.equal(designer.convertedCount, 1);
    const website = await list(webManager, 'website-platform-summary');
    assert.equal(website.total, 1);
    assert.equal(website.list[0].id, 'website');
    assert.equal(website.list[0].quotedCount, 3);
    // Disabled and renamed master records must not erase historical snapshot groupings.
    await h.db.query(
      "UPDATE business_groups SET name='Changed master name',status='disabled' WHERE id=$1",
      [red],
    );
    assert.equal(
      (await list(lxManager, 'linxi-platform-summary', '?keyword=Red')).list[0]
        .name,
      'Red group',
    );

    await deny(lx, 'GET', path('linxi-quote-summary'));
    await deny(resource, 'GET', path('linxi-platform-summary'));
    await deny(sx, 'GET', path('website-quote-summary'));
    await deny(
      root,
      'GET',
      '/ledgers/summaries/unknown',
      undefined,
      400,
      'VALIDATION_ERROR',
    );
    await deny(
      sxManager,
      'GET',
      path('shengxu-agency-summary') + '?from=2026-11-02&to=2026-10-01',
      undefined,
      400,
      'VALIDATION_ERROR',
    );
    await deny(
      sxManager,
      'GET',
      path('shengxu-agency-summary') + '?from=2026-02-30',
      undefined,
      400,
      'VALIDATION_ERROR',
    );
    await deny(
      sxManager,
      'GET',
      path('shengxu-agency-summary') + '?pageSize=101',
      undefined,
      400,
      'VALIDATION_ERROR',
    );
    await deny(
      undefined,
      'GET',
      path('shengxu-agency-summary'),
      undefined,
      401,
      'AUTH_TOKEN_INVALID',
    );
    await deny(
      sxManager,
      'PUT',
      `${path('shengxu-agency-summary')}/${agency}`,
      { version: 0, firstFollowUp: 'Called once', tourNumbers: 'YNSS001' },
      404,
      'NOT_FOUND',
    );

    // Opening menus grants summaries without granting raw ledgers or cross-business access.
    await h.db.query(
      `UPDATE role_menu_configs c SET menu_keys=array_append(menu_keys,'linxi-quote-summary') FROM roles r WHERE r.id=c.role_id AND r.code IN ('COORDINATOR','RESOURCE_MANAGER')`,
    );
    const resourceOn = await h.actor('linxi', 'RESOURCE_MANAGER');
    const coordinatorOn = await h.actor('linxi');
    for (const actor of [resourceOn, coordinatorOn]) {
      assert.equal((await list(actor, 'linxi-quote-summary')).total, 1);
      await deny(actor, 'GET', path('website-quote-summary'));
    }
    await deny(resourceOn, 'GET', '/ledgers/direct?businessUnit=linxi');
    // Existing sessions retain their original snapshot; a new login sees the toggle.
    await deny(resource, 'GET', path('linxi-quote-summary'));
    await h.db.query(
      `UPDATE role_menu_configs c SET menu_keys=array_remove(menu_keys,'linxi-quote-summary') FROM roles r WHERE r.id=c.role_id AND r.code='BUSINESS_MANAGER'`,
    );
    const managerOff = await h.actor('linxi', 'BUSINESS_MANAGER');
    await deny(managerOff, 'GET', path('linxi-quote-summary'));
    await deny(managerOff, 'PUT', `${path('linxi-quote-summary')}/${lx.id}`, {
      version: 1,
      tourNumbers: 'forbidden',
    });
    assert.equal((await list(managerOff, 'linxi-platform-summary')).total, 3);
    assert.equal((await list(root, 'linxi-quote-summary')).total, 1);
    console.log(
      `Ledger summaries passed: empty/repeated migrations, representative upgrade preservation, aggregation/date/pagination/snapshots, ${h.requests} HTTP checks, menu defaults/toggles/business isolation and concurrent notes.`,
    );
  } finally {
    await h.close();
  }
}
void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
