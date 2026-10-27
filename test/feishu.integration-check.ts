/** Disposable PostgreSQL only; fake sender never contacts Feishu. */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { IsolationHarness } from './business-isolation.harness';
import { AddFeishuNotifications1794009600000 } from '../src/migrations/1794009600000-AddFeishuNotifications';
import { FeishuService } from '../src/feishu/feishu.service';
import { LedgerNotificationsService } from '../src/ledgers/ledger-notifications.service';
import { DirectLedgersService } from '../src/ledgers/direct-ledgers.service';
import {
  CreateDirectLedgerDto,
  UpdateDirectLedgerDto,
} from '../src/ledgers/ledger.dto';
import { AuthenticatedUser } from '../src/auth/auth.types';
import { effectivePermissions } from '../src/auth/identity-permissions';
import { UserManagementService } from '../src/users/user-management.service';
import { UserEntity } from '../src/users/user.entity';
import { RoleEntity } from '../src/roles/role.entity';

const h = new IsolationHarness();
const sent: { openId: string; uuid: string; text: string }[] = [];
let fail = false;
const sender = new FeishuService(
  new ConfigService({
    FEISHU_APP_ID: 'fixture-app',
    FEISHU_APP_SECRET: 'fixture-secret',
    FEISHU_WEB_BASE_URL: 'https://example.test',
  }),
);
sender.sendText = (openId, text, uuid) => {
  sent.push({ openId, text, uuid });
  if (fail) return Promise.reject(new Error('fixture delivery failure'));
  return Promise.resolve({ messageId: `fixture-${uuid}` });
};
async function main() {
  // Apply the existing chain first, create representative old rows, then upgrade.
  const directory = resolve(__dirname, '../src/migrations');
  h.db.setOptions({
    migrations: readdirSync(directory)
      .filter(
        (name) =>
          name.endsWith('.ts') && !name.includes('AddFeishuNotifications'),
      )
      .map((name) => resolve(directory, name)),
  });
  await h.start();
  try {
    const oldUser = randomUUID();
    await h.db.query(
      `INSERT INTO users(id,username,nickname,english_name,password_hash) VALUES($1,'feishu_old','Old','Old','fixture')`,
      [oldUser],
    );
    const [oldLedger] = await h.db.query<{ id: string; order_no: string }[]>(
      `INSERT INTO direct_ledgers(business_unit,received_date,source,creator_id,creator_name,operator_id,operator_name,receiving_account_name,updated_by)
      VALUES('website','2026-10-26','old source',$1,'Old',$1,'Old','独立站',$1) RETURNING id,order_no`,
      [oldUser],
    );
    h.db.migrations.push(new AddFeishuNotifications1794009600000());
    assert.equal((await h.db.runMigrations()).length, 1);
    assert.equal((await h.db.runMigrations()).length, 0);
    assert.equal(
      (
        await h.db.query<{ feishu_open_id: string }[]>(
          `SELECT feishu_open_id FROM users WHERE id=$1`,
          [oldUser],
        )
      )[0].feishu_open_id,
      '',
    );
    assert.equal(
      (
        await h.db.query<{ order_no: string }[]>(
          `SELECT order_no FROM direct_ledgers WHERE id=$1`,
          [oldLedger.id],
        )
      )[0].order_no,
      oldLedger.order_no,
    );
    await assert.rejects(
      h.db.query(`UPDATE users SET feishu_open_id='invalid' WHERE id=$1`, [
        oldUser,
      ]),
    );

    const collector = await h.actor('website');
    const operator = await h.actor('website');
    const otherOperator = await h.actor('website');
    const manager = await h.actor('website', 'BUSINESS_MANAGER');
    const foreignManager = await h.actor('linxi', 'BUSINESS_MANAGER');
    const root = await h.actor('headquarters', 'ROOT');
    for (const person of [
      operator,
      otherOperator,
      manager,
      foreignManager,
      root,
    ])
      await h.db.query(`UPDATE users SET feishu_open_id=$2 WHERE id=$1`, [
        person.id,
        `ou_${person.scope}_${person.id}`,
      ]);
    const actor: AuthenticatedUser = {
      ...collector,
      roles: ['COORDINATOR'],
      permissions: effectivePermissions('website', ['COORDINATOR']),
      menuKeys: [],
    } as unknown as AuthenticatedUser;
    const managerActor = {
      ...actor,
      ...manager,
      roles: ['BUSINESS_MANAGER'],
      permissions: effectivePermissions('website', ['BUSINESS_MANAGER']),
    };
    const [coordinatorRole] = await h.db.query<{ id: string }[]>(
      `SELECT id FROM roles WHERE code='COORDINATOR'`,
    );
    const bindingInput = {
      username: 'feishu_binding',
      nickname: 'Binding',
      englishName: 'Binding',
      tourCode: 'FSHU',
      identities: [
        { scope: 'website', deptId: 7, roleIds: [coordinatorRole.id] },
      ],
      feishuOpenId: '  ou_binding  ',
    };
    const bound = await h.call<{ id: string; feishuOpenId: string }>(
      manager,
      'POST',
      '/users',
      bindingInput,
      201,
    );
    assert.equal(bound.feishuOpenId, 'ou_binding');
    assert.equal(
      (
        await h.call<{ feishuOpenId: string }>(
          manager,
          'GET',
          `/users/${bound.id}`,
        )
      ).feishuOpenId,
      'ou_binding',
    );
    const {
      username: _username,
      feishuOpenId: _binding,
      ...editInput
    } = bindingInput;
    void _username;
    void _binding;
    assert.equal(
      (
        await h.call<{ feishuOpenId: string }>(
          manager,
          'PUT',
          `/users/${bound.id}`,
          editInput,
        )
      ).feishuOpenId,
      'ou_binding',
    );
    await h.call(
      manager,
      'PUT',
      `/users/${bound.id}`,
      { ...editInput, feishuOpenId: null },
      400,
      'VALIDATION_ERROR',
    );
    assert.equal(
      (
        await h.call<{ feishuOpenId: string }>(
          manager,
          'PUT',
          `/users/${bound.id}`,
          { ...editInput, feishuOpenId: '' },
        )
      ).feishuOpenId,
      '',
    );
    const notifications = new LedgerNotificationsService(h.db, sender);
    const ledgers = new DirectLedgersService(h.db, notifications);
    const input = Object.assign(new CreateDirectLedgerDto(), {
      receivedDate: '2026-10-26',
      source: 'fixture',
      operatorId: operator.id,
      loss: true,
      lossNote: '亏损测试备注' + '😀'.repeat(130),
      orderStatus: 'converted',
      proposalSent: true,
    });
    let row = await ledgers.create(input, actor);
    const jobs = (id = row.id) =>
      h.db.query<
        { id: string; recipient_id: string; status: string; attempts: number }[]
      >(
        `SELECT * FROM feishu_ledger_notifications WHERE ledger_id=$1 ORDER BY created_at,id`,
        [id],
      );
    assert.deepEqual(
      (await jobs()).map((job) => job.recipient_id),
      [manager.id],
    );
    assert.equal(
      sent.length,
      0,
      'enqueue must not send inside business transaction',
    );
    row = await ledgers.update(
      row.id,
      Object.assign(new UpdateDirectLedgerDto(), input, {
        version: row.version,
        remark: 'ordinary edit',
      }),
      actor,
    );
    assert.equal((await jobs()).length, 1, 'ordinary edits must not duplicate');
    // Two consumers share row claims; send each job once.
    await Promise.all([
      notifications.drain(),
      new LedgerNotificationsService(h.db, sender).drain(),
    ]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].openId, `ou_website_${manager.id}`);
    assert(sent[0].text.includes(row.orderNo));
    assert(sent[0].text.includes('业务部门：独立站'));
    assert(sent[0].text.includes(`收客计调：${row.creatorName}`));
    assert(sent[0].text.includes('来源：fixture'));
    assert(sent[0].text.includes('接单账号：独立站'));
    assert(sent[0].text.includes('是否亏损：是'));
    assert(
      sent[0].text.includes(
        '亏损备注：亏损测试备注' + '😀'.repeat(114) + '...',
      ),
    );
    assert(sent[0].text.includes('/data-ledgers/website?keyword='));
    row = await ledgers.review(row.id, row.version, managerActor);
    assert.equal((await jobs()).length, 2);
    fail = true;
    await notifications.drain();
    assert(sent.at(-1)!.text.includes('台账待操作'));
    assert(sent.at(-1)!.text.includes('来源：fixture'));
    assert(!sent.at(-1)!.text.includes('亏损备注'));
    const failedUuid = sent.at(-1)!.uuid;
    assert.equal(
      (await jobs()).find((job) => job.id === failedUuid)!.attempts,
      1,
    );
    fail = false;
    await h.db.query(
      `UPDATE feishu_ledger_notifications SET next_attempt_at=now() WHERE id=$1`,
      [failedUuid],
    );
    await notifications.drain();
    assert.equal(sent.at(-1)!.uuid, failedUuid);
    assert.equal(sent.at(-1)!.openId, `ou_website_${operator.id}`);
    assert.equal(
      (await jobs()).find((job) => job.id === failedUuid)!.status,
      'sent',
    );

    const initial = Object.assign(new CreateDirectLedgerDto(), input, {
      loss: false,
      orderStatus: 'unconverted',
      proposalSent: false,
    });
    let ready = await ledgers.create(initial, actor);
    assert.equal(
      (await jobs(ready.id)).length,
      0,
      'pending status without prerequisites must not notify',
    );
    const readyInput = Object.assign(new UpdateDirectLedgerDto(), initial, {
      version: ready.version,
      orderStatus: 'converted',
      proposalSent: true,
    });
    ready = await ledgers.update(ready.id, readyInput, actor);
    const firstJob = (await jobs(ready.id))[0];
    ready = await ledgers.update(
      ready.id,
      Object.assign(readyInput, {
        version: ready.version,
        operatorId: otherOperator.id,
      }),
      actor,
    );
    assert.equal(
      (await jobs(ready.id)).find((job) => job.id === firstJob.id)!.status,
      'skipped',
    );
    const before = sent.length;
    await h.db.query(`UPDATE users SET status='disabled' WHERE id=$1`, [
      otherOperator.id,
    ]);
    await notifications.drain();
    assert.equal(
      sent.length,
      before,
      'disabled recipients must not receive queued messages',
    );

    // Bounded retries and business data remain intact after delivery failures.
    const failing = await ledgers.create(input, actor);
    fail = true;
    for (let attempt = 0; attempt < 4; attempt++) {
      await h.db.query(
        `UPDATE feishu_ledger_notifications SET next_attempt_at=now() WHERE ledger_id=$1 AND status='pending'`,
        [failing.id],
      );
      await notifications.drain();
    }
    assert.equal((await jobs(failing.id))[0].status, 'failed');
    assert.equal((await jobs(failing.id))[0].attempts, 4);
    assert.equal((await ledgers.get(failing.id, actor)).loss, true);
    fail = false;
    // Queue and ledger transaction roll back together even if failure occurs after enqueue.
    const rollbackQueue = new LedgerNotificationsService(h.db, sender);
    const enqueue = rollbackQueue.enqueue.bind(rollbackQueue);
    rollbackQueue.enqueue = async (...args) => {
      await enqueue(...args);
      throw new Error('fixture rollback');
    };
    const count = (
      await h.db.query<{ count: string }[]>(
        `SELECT count(*) FROM feishu_ledger_notifications`,
      )
    )[0].count;
    await assert.rejects(
      new DirectLedgersService(h.db, rollbackQueue).create(input, actor),
    );
    assert.equal(
      (
        await h.db.query<{ count: string }[]>(
          `SELECT count(*) FROM feishu_ledger_notifications`,
        )
      )[0].count,
      count,
    );

    // Real guards and HTTP paths: cross-scope direct ID access, read-only callers, missing binding/configuration.
    await h.call(
      collector,
      'POST',
      `/users/${manager.id}/feishu-test`,
      { template: 'review' },
      403,
      'AUTH_FORBIDDEN',
    );
    await h.call(
      manager,
      'POST',
      `/users/${foreignManager.id}/feishu-test`,
      { template: 'review' },
      404,
      'USER_NOT_FOUND',
    );
    await h.call(
      manager,
      'POST',
      `/users/${collector.id}/feishu-test`,
      { template: 'review' },
      400,
      'VALIDATION_ERROR',
    );
    await h.call(
      manager,
      'POST',
      `/users/${operator.id}/feishu-test`,
      { template: 'operate' },
      503,
      'FEISHU_NOT_CONFIGURED',
    );
    for (const body of [
      {},
      { template: 'other' },
      { template: null },
      { template: 'review', text: 'custom' },
    ]) {
      await h.call(
        manager,
        'POST',
        `/users/${operator.id}/feishu-test`,
        body,
        400,
        'VALIDATION_ERROR',
      );
    }
    const users = new UserManagementService(
      h.db.getRepository(UserEntity),
      h.db.getRepository(RoleEntity),
      h.db,
      sender,
    );
    const countBefore = await h.db.query<{ count: string }[]>(
      `SELECT count(*) FROM feishu_ledger_notifications`,
    );
    for (const template of ['review', 'operate'] as const) {
      assert(
        (await users.testFeishu(operator.id, template, managerActor)).messageId,
      );
      assert(sent.at(-1)!.text.includes('【模拟提醒】'));
      assert(
        sent
          .at(-1)!
          .text.includes(template === 'review' ? '台账待审核' : '台账待操作'),
      );
      assert(!sent.at(-1)!.text.includes('打开台账'));
    }
    assert.deepEqual(
      await h.db.query(`SELECT count(*) FROM feishu_ledger_notifications`),
      countBefore,
    );
    assert.equal(sent.at(-1)!.openId, `ou_website_${operator.id}`);
    console.log(
      'PASS Feishu: old-data upgrade, constraints, transaction rollback, scoped recipients, prerequisites, deduplication, concurrency, bounded retry, stale recipient suppression, real HTTP permissions, template validation and simulated reminders',
    );
  } finally {
    await h.close();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
