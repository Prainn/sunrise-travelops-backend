import { appendFollowUp } from '../src/inquiries/follow-ups';
/** Disposable local database and synthetic accounts only; all Feishu calls are replaced. */
import assert from 'node:assert/strict';
import { IsolationHarness, Actor, Page } from './business-isolation.harness';
import { WhatsappEvents } from '../src/whatsapp/whatsapp.events';
import { WhatsappNotificationsService } from '../src/whatsapp/whatsapp-notifications.service';
import {
  FeishuSendException,
  FeishuService,
} from '../src/feishu/feishu.service';
import {
  LedgerReminderRow,
  LedgerNotificationsService,
} from '../src/ledgers/ledger-notifications.service';
import { InquiryRemindersService } from '../src/inquiries/inquiry-reminders.service';
import { Conversation } from '../src/whatsapp/whatsapp.types';
import { NotificationType } from '../src/notifications/notification-settings';

const h = new IsolationHarness({
  WHATSAPP_CHAT_ENABLED: 'true',
  WHATSAPP_CHAT_WORKER_ENABLED: 'false',
  WHATSAPP_CHAT_RECEIVE_MODE: 'http',
  WHATSAPP_CHAT_SEND_ENABLED: 'false',
  WHATSAPP_CHAT_ENVIRONMENT: 'test',
  WHATSAPP_CHAT_SPACE_ID: 'test-space',
  WHATSAPP_CHAT_WABA_ID: 'test-waba',
  WHATSAPP_CHAT_PHONE: '0000000000',
  WHATSAPP_CHAT_HTTP_TOKEN: 'test-only-http-ingress-token-not-a-production-key',
  FEISHU_WEB_BASE_URL: 'https://example.test',
});
interface Setting {
  type: NotificationType;
  enabled: boolean;
  version: number;
}
let checks = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  console.log(`PASS ${++checks}: ${name}`);
}
async function main() {
  await h.start();
  const worker = h.get(WhatsappNotificationsService);
  await worker.onModuleDestroy();
  await h.get(LedgerNotificationsService).onModuleDestroy();
  await h.get(InquiryRemindersService).onModuleDestroy();
  const feishu = h.get(FeishuService);
  Object.defineProperty(feishu, 'configured', { get: () => true });
  const sent: { openId: string; text: string; uuid: string }[] = [];
  const send = (openId: string, text: string, uuid: string) => {
    sent.push({ openId, text, uuid });
    return Promise.resolve({ messageId: `mock-${uuid}` });
  };
  feishu.sendText = send;
  const events = h.get(WhatsappEvents);
  const admin = await h.actor('headquarters', 'ADMIN');
  const root = await h.actor('headquarters', 'ROOT');
  const executive = await h.actor('headquarters', 'EXECUTIVE');
  const manager = await h.actor('website', 'BUSINESS_MANAGER');
  const manager2 = await h.actor('website', 'BUSINESS_MANAGER');
  const duplicateManager = await h.actor('website', 'BUSINESS_MANAGER');
  const unboundManager = await h.actor('website', 'BUSINESS_MANAGER');
  const unrelated = await h.actor('linxi', 'BUSINESS_MANAGER');
  const a = await h.actor('website');
  const b = await h.actor('website');
  const unbound = await h.actor('website');
  for (const [actor, id] of [
    [manager, 'ou_manager'],
    [manager2, 'ou_manager2'],
    [duplicateManager, 'ou_manager'],
    [unrelated, 'ou_unrelated'],
    [a, 'ou_a'],
    [b, 'ou_b'],
  ] as [Actor, string][])
    await h.db.query('UPDATE users SET feishu_open_id=$2 WHERE id=$1', [
      actor.id,
      id,
    ]);
  const payload = (
    id: string,
    contact = 'ZZ.test-contact',
    extra: Record<string, unknown> = {},
  ) => ({
    MessageId: id,
    CustSpaceId: 'test-space',
    WabaId: 'test-waba',
    FromUserId: contact,
    From: contact,
    To: '0000000000',
    Name: 'Synthetic customer',
    Type: 'TEXT',
    Message: 'Synthetic message',
    Timestamp: Date.now(),
    ...extra,
  });
  const incoming = async (
    id: string,
    contact?: string,
    extra?: Record<string, unknown>,
  ) => {
    await events.receive(payload(id, contact, extra), 'inbound');
    assert(await events.processOne());
  };
  const list = () =>
    h.call<Page<Conversation>>(manager, 'GET', '/whatsapp/conversations');
  let c: Conversation;
  const refresh = async () => {
    c = await h.call<Conversation>(
      manager,
      'GET',
      `/whatsapp/conversations/${c.id}`,
    );
    return c;
  };
  const assign = async (actor: Actor) => {
    await refresh();
    c = await h.call<Conversation>(
      manager,
      'POST',
      `/whatsapp/conversations/${c.id}/assign`,
      { ownerId: actor.id, version: c.version },
    );
  };
  const settings = () =>
    h.call<Setting[]>(admin, 'GET', '/system/notifications');
  const toggle = async (type: NotificationType, enabled: boolean) => {
    const row = (await settings()).find((s) => s.type === type)!;
    return h.call<Setting>(admin, 'PUT', `/system/notifications/${type}`, {
      enabled,
      version: row.version,
    });
  };
  const due = async () => {
    await h.db.query(
      `UPDATE whatsapp_notification_deliveries SET next_attempt_at=now()-interval '1 second' WHERE status='pending'`,
    );
  };

  await check(
    'migration preserves old data, supports empty rollback/up and repeated migration run',
    async () => {
      const before = (
        await h.db.query<{ n: number }[]>('SELECT count(*)::int n FROM users')
      )[0].n;
      await h.db.undoLastMigration();
      assert.equal((await h.db.runMigrations()).length, 1);
      assert.equal((await h.db.runMigrations()).length, 0);
      assert.equal(
        (
          await h.db.query<{ n: number }[]>('SELECT count(*)::int n FROM users')
        )[0].n,
        before,
      );
      assert.equal((await settings()).length, 8);
    },
  );
  await check(
    'settings require HQ ADMIN/ROOT, validate DTO/type, reject stale versions',
    async () => {
      await h.call(root, 'GET', '/system/notifications');
      await h.call(
        undefined,
        'GET',
        '/system/notifications',
        undefined,
        401,
        'AUTH_TOKEN_INVALID',
      );
      for (const actor of [manager, a, unrelated, executive]) {
        await h.call(
          actor,
          'GET',
          '/system/notifications',
          undefined,
          403,
          'AUTH_FORBIDDEN',
        );
        await h.call(
          actor,
          'PUT',
          '/system/notifications/whatsapp_message',
          { enabled: false, version: 1 },
          403,
          'AUTH_FORBIDDEN',
        );
      }
      await h.call(
        admin,
        'PUT',
        '/system/notifications/unknown',
        { enabled: true, version: 1 },
        404,
        'NOT_FOUND',
      );
      for (const body of [
        { enabled: 'false', version: 1 },
        { enabled: false },
        { enabled: false, version: 1, recipient: a.id },
      ])
        await h.call(
          admin,
          'PUT',
          '/system/notifications/whatsapp_message',
          body,
          400,
          'VALIDATION_ERROR',
        );
      await toggle('whatsapp_message', false);
      await h.call(
        admin,
        'PUT',
        '/system/notifications/whatsapp_message',
        { enabled: true, version: 1 },
        409,
        'CONFLICT',
      );
      await toggle('whatsapp_message', true);
    },
  );
  await check(
    'first inbound immediately notifies all bound website managers, deduplicating Open ID',
    async () => {
      const raw = payload('first');
      await events.receive([raw, raw], 'inbound');
      await events.processOne();
      c = (await list()).list[0];
      await Promise.all([worker.drain(), worker.drain()]);
      assert.deepEqual(sent.map((s) => s.openId).sort(), [
        'ou_manager',
        'ou_manager2',
      ]);
      assert(
        sent.every(
          (s) =>
            s.text.includes('待分配') &&
            s.text.includes(`conversationId=${c.id}`),
        ),
      );
      await events.receive(
        { ...raw, Name: 'duplicate payload variation' },
        'inbound',
      );
      await events.processOne();
      await worker.drain();
      assert.equal(sent.length, 2);
    },
  );
  await check(
    'continuous messages share fixed 30-second bucket; due time does not slide',
    async () => {
      await incoming('second');
      const [firstBatch] = await h.db.query<{ id: string; due_at: Date }[]>(
        `SELECT id,due_at FROM whatsapp_notification_batches WHERE status='pending' AND conversation_id=$1`,
        [c.id],
      );
      await incoming('third');
      await worker.drain();
      assert.equal(sent.length, 2);
      const [batch] = await h.db.query<
        { due_at: Date; message_count: number }[]
      >('SELECT * FROM whatsapp_notification_batches WHERE id=$1', [
        firstBatch.id,
      ]);
      assert.equal(batch.due_at.getTime(), firstBatch.due_at.getTime());
      assert.equal(batch.message_count, 2);
      await due();
      await worker.drain();
      assert.equal(sent.length, 4);
      assert(sent.slice(2).every((s) => s.text.includes('新增消息：2条')));
    },
  );
  await check(
    'assignment consumes pending manager messages and sends one immediate handoff',
    async () => {
      await incoming('before-assignment');
      await assign(a);
      await worker.drain();
      assert.equal(sent.length, 5);
      assert.equal(sent.at(-1)?.openId, 'ou_a');
      assert(sent.at(-1)?.text.includes('分配提醒'));
      await due();
      await worker.drain();
      assert.equal(sent.length, 5);
    },
  );
  await check(
    'reassignment redirects unsent messages; subsequent messages go only to new owner',
    async () => {
      await incoming('before-reassignment');
      await assign(b);
      await worker.drain();
      assert.equal(sent.at(-1)?.openId, 'ou_b');
      assert(sent.at(-1)?.text.includes('改派提醒'));
      const before = sent.length;
      await incoming('owner-message');
      await due();
      await worker.drain();
      assert.equal(sent.length, before + 1);
      assert.equal(sent.at(-1)?.openId, 'ou_b');
    },
  );
  await check(
    'unbound assignee can be assigned/reassigned; later binding does not replay skipped events',
    async () => {
      const before = sent.length;
      await assign(unbound);
      await incoming('unbound-message');
      await worker.drain();
      assert.equal(sent.length, before);
      await h.db.query(
        "UPDATE users SET feishu_open_id='ou_later' WHERE id=$1",
        [unbound.id],
      );
      await due();
      await worker.drain();
      assert.equal(sent.length, before);
      await incoming('new-after-binding');
      await due();
      await worker.drain();
      assert.equal(sent.length, before + 1);
      assert.equal(sent.at(-1)?.openId, 'ou_later');
    },
  );
  await check(
    'off/on invalidates already queued and disabled-period notifications without blocking assignment',
    async () => {
      await incoming('queued-before-off');
      await toggle('whatsapp_message', false);
      await incoming('during-off');
      await toggle('whatsapp_message', true);
      const before = sent.length;
      await due();
      await worker.drain();
      assert.equal(sent.length, before);
      await incoming('after-on');
      await worker.drain();
      assert.equal(sent.length, before + 1);
      await toggle('whatsapp_assignment', false);
      await assign(a);
      await worker.drain();
      assert.equal(sent.length, before + 1);
      await toggle('whatsapp_assignment', true);
      await assign(b);
      await worker.drain();
      assert.equal(sent.length, before + 2);
    },
  );
  await check(
    'closed consultation cancels pending; reopening on new inbound routes current owner',
    async () => {
      await incoming('close-pending');
      await refresh();
      c = await h.call<Conversation>(
        manager,
        'POST',
        `/whatsapp/conversations/${c.id}/state`,
        { state: 'closed', version: c.version },
      );
      const before = sent.length;
      await due();
      await worker.drain();
      assert.equal(sent.length, before);
      await incoming('reopen');
      await worker.drain();
      assert.equal(sent.length, before + 1);
    },
  );
  await check(
    'reaction, edit and mobile echo never trigger notifications',
    async () => {
      const before = sent.length;
      await incoming('reaction', undefined, {
        Type: 'REACTION',
        Message: { emoji: '👍', message_id: 'first' },
      });
      await incoming('edit', undefined, {
        Type: 'TEXT',
        Message: 'edited',
        NoticeType: 'echos',
        From: '0000000000',
        To: 'ZZ.test-contact',
        UserId: 'ZZ.test-contact',
      });
      await incoming('real-edit', undefined, {
        Type: 'INTERACTIVE',
        Message: { type: 'edit', message_id: 'first', text: 'edit' },
      });
      await due();
      await worker.drain();
      assert.equal(sent.length, before);
    },
  );
  await check(
    'one recipient failure does not block another; known rejection retries stable UUID',
    async () => {
      let fail = true;
      feishu.sendText = async (openId, text, uuid) => {
        if (openId === 'ou_manager' && fail)
          throw new FeishuSendException(false);
        return send(openId, text, uuid);
      };
      await incoming('failure-first', 'ZZ.failure');
      const before = sent.length;
      await worker.drain();
      assert.equal(sent.length, before + 1);
      const [pending] = await h.db.query<{ id: string }[]>(
        `SELECT id FROM whatsapp_notification_deliveries WHERE status='pending' AND open_id='ou_manager'`,
      );
      assert(pending);
      fail = false;
      await due();
      await worker.drain();
      assert.equal(sent.at(-1)?.uuid, pending.id);
      feishu.sendText = send;
    },
  );
  await check(
    'unknown delivery and abandoned claim are not automatically resent',
    async () => {
      feishu.sendText = () => Promise.reject(new FeishuSendException(true));
      await incoming('unknown-first', 'ZZ.unknown');
      await worker.drain();
      const [unknown] = await h.db.query<{ n: number }[]>(
        `SELECT count(*)::int n FROM whatsapp_notification_deliveries WHERE status='unknown'`,
      );
      assert.equal(unknown.n, 2);
      feishu.sendText = send;
      const before = sent.length;
      await due();
      await worker.drain();
      assert.equal(sent.length, before);
      await incoming('crashed-first', 'ZZ.crashed');
      await h.db.query(
        `UPDATE whatsapp_notification_deliveries SET status='sending',claimed_at=now()-interval '3 minutes' WHERE status='pending'`,
      );
      await worker.drain();
      assert.equal(sent.length, before);
    },
  );
  await check(
    'live recipient eligibility is rechecked and history archived messages stay silent',
    async () => {
      await incoming('eligibility', 'ZZ.eligibility');
      await h.db.query(
        "UPDATE users SET status='disabled' WHERE id=ANY($1::uuid[])",
        [[manager2.id, duplicateManager.id, manager.id]],
      );
      const before = sent.length;
      await worker.drain();
      assert.equal(sent.length, before);
      await h.db.query(
        "UPDATE users SET status='enabled' WHERE id=ANY($1::uuid[])",
        [[manager2.id, duplicateManager.id, manager.id]],
      );
      const past = Date.now() - 10000;
      await h.db.query(
        "UPDATE whatsapp_conversations SET state='archived',archived_at=now() WHERE id=$1",
        [c.id],
      );
      await incoming('late-archived', undefined, { Timestamp: past });
      await worker.drain();
      assert.equal(sent.length, before);
    },
  );
  await check(
    'linked inquiry transfer generates exactly one handoff through either entry point',
    async () => {
      await incoming('linked-first', 'ZZ.linked');
      const chat = (await list()).list.find(
        (row) => row.id !== c.id && row.state === 'open',
      );
      assert(chat);
      const [linkedChat] = await h.db.query<{ id: string }[]>(
        `SELECT c.id FROM whatsapp_conversations c JOIN whatsapp_contacts p ON p.id=c.contact_id WHERE p.bsuid='ZZ.linked'`,
      );
      c = await h.call<Conversation>(
        manager,
        'GET',
        `/whatsapp/conversations/${linkedChat.id}`,
      );
      await assign(a);
      await worker.drain();
      const [country] = await h.db.query<{ id: string }[]>(
        "SELECT id FROM system_business_dictionary_items WHERE code='UNKNOWN' LIMIT 1",
      );
      const inquiry = await h.call<{ id: string; version: number }>(
        a,
        'POST',
        '/website/inquiries',
        {
          countryItemId: country.id,
          customerName: 'Synthetic linked',
          plannedDays: 1,
          requirements: 'test',
        },
        201,
      );
      await h.db.query(
        'UPDATE whatsapp_conversations SET inquiry_id=$2 WHERE id=$1',
        [c.id, inquiry.id],
      );
      const before = sent.length;
      await h.call(
        manager,
        'POST',
        `/website/inquiries/${inquiry.id}/transfer`,
        { ownerId: b.id, version: inquiry.version, reason: 'test' },
        201,
      );
      await worker.drain();
      assert.equal(sent.length, before + 1);
      assert.equal(sent.at(-1)?.openId, 'ou_b');
      await assign(a);
      await worker.drain();
      assert.equal(sent.length, before + 2);
      assert.equal(sent.at(-1)?.openId, 'ou_a');
    },
  );
  await check(
    'existing ledger notifications obey switches and keep exact record/action links',
    async () => {
      const [row] = await h.db.query<LedgerReminderRow[]>(
        `INSERT INTO direct_ledgers(business_unit,received_date,source,creator_id,creator_name,receiving_account_name,operator_id,operator_name,loss,updated_by)
      VALUES('website',current_date,'Synthetic',$1,'Synthetic','独立站',$1,'Synthetic',true,$1)
      RETURNING id,version,business_unit AS "businessUnit",order_no AS "orderNo",creator_name AS "creatorName",source,receiving_account_name AS "receivingAccountName",loss_note AS "lossNote",operator_id AS "operatorId",loss,reviewed_at AS "reviewedAt",operated,proposal_sent AS "proposalSent",order_status AS "orderStatus"`,
        [a.id],
      );
      const ledger = h.get(LedgerNotificationsService);
      await toggle('website_ledger_review', false);
      await h.db.transaction((manager) => ledger.enqueue(manager, row));
      assert.equal(
        (
          await h.db.query<unknown[]>(
            'SELECT id FROM feishu_ledger_notifications WHERE ledger_id=$1',
            [row.id],
          )
        ).length,
        0,
      );
      await toggle('website_ledger_review', true);
      await h.db.transaction((manager) => ledger.enqueue(manager, row));
      await toggle('website_ledger_review', false);
      await toggle('website_ledger_review', true);
      const before = sent.length;
      await ledger.drain();
      assert.equal(sent.length, before);
      await h.db.transaction((manager) =>
        ledger.enqueue(manager, { ...row, version: 2 }),
      );
      await ledger.drain();
      assert(sent.length > before);
      assert(
        sent
          .slice(before)
          .every(
            (message) =>
              message.text.includes(`ledgerId=${row.id}`) &&
              message.text.includes('action=review') &&
              message.text.includes('highlight=1'),
          ),
      );
    },
  );
  await check(
    'follow-up switch preserves business records, suppresses disabled and old pending jobs',
    async () => {
      const coordinator = await h.actor('shengxu');
      await h.db.query(
        "UPDATE users SET feishu_open_id='ou_follow' WHERE id=$1",
        [coordinator.id],
      );
      const [inquiry] = await h.db.query<{ id: string }[]>(
        `INSERT INTO inquiries(code,owner_id,owner,status,creator,business_unit,agency_id,contact_id,agency_code,agency_name,contact_name,email,phone,country_or_region,source_channel,original_message,internal_remark,planned_days,next_follow_up_at,lost_reason)
      VALUES('INQ-NOTIFY',$1,'Synthetic','new','Synthetic','shengxu',gen_random_uuid(),gen_random_uuid(),'A','Synthetic','Synthetic','','','China','','','',1,'2035-01-01T08:00:00.000Z','') RETURNING id`,
        [coordinator.id],
      );
      const append = () =>
        h.db.transaction((manager) =>
          appendFollowUp(
            manager,
            inquiry.id,
            {
              remark: 'Synthetic follow-up',
              nextFollowUpAt: '2035-01-01T08:00:00.000Z',
              reminderDays: 1,
            },
            { id: coordinator.id, name: 'Synthetic' },
          ),
        );
      await toggle('inquiry_follow_up', false);
      const skipped = await append();
      const [record] = await h.db.query<{ status: string }[]>(
        'SELECT status FROM inquiry_follow_up_reminders WHERE follow_up_id=$1',
        [skipped],
      );
      assert.equal(record.status, 'cancelled');
      await toggle('inquiry_follow_up', true);
      await append();
      await toggle('inquiry_follow_up', false);
      await toggle('inquiry_follow_up', true);
      await h.db.query(
        "UPDATE inquiry_follow_up_reminders SET due_at=now()-interval '1 second' WHERE inquiry_id=$1",
        [inquiry.id],
      );
      const before = sent.length;
      await h.get(InquiryRemindersService).drain();
      assert.equal(sent.length, before);
      await append();
      await h.db.query(
        "UPDATE inquiry_follow_up_reminders SET due_at=now()-interval '1 second' WHERE inquiry_id=$1",
        [inquiry.id],
      );
      await h.get(InquiryRemindersService).drain();
      assert.equal(sent.length, before + 1);
      assert.equal(sent.at(-1)?.openId, 'ou_follow');
    },
  );
  await check(
    'all notification type switches are independent and migration refuses destructive rollback with history',
    async () => {
      const untouched = await settings();
      await toggle('website_ledger_review', false);
      const after = await settings();
      for (const row of untouched.filter(
        (s) => s.type !== 'website_ledger_review',
      ))
        assert.deepEqual(
          after.find((s) => s.type === row.type),
          row,
        );
      await assert.rejects(h.db.undoLastMigration(), /must be retained/);
      assert.equal((await h.db.runMigrations()).length, 0);
      assert(unboundManager.id);
    },
  );
  console.log(
    `Completed ${checks} checks / ${h.requests} real HTTP requests; no cloud calls.`,
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => h.close());
