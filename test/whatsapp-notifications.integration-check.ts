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
import { NotificationDigestsService } from '../src/notifications/notification-digests.service';
import { FeishuNotificationWindows1796256021000 } from '../src/migrations/1796256021000-FeishuNotificationWindows';
import {
  NotificationWindow,
  NotificationType,
} from '../src/notifications/notification-settings';

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
  sendWindow: NotificationWindow | null;
}
let checks = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  console.log(`PASS ${++checks}: ${name}`);
}
async function main() {
  await h.start({
    from: 1796256021000,
    seed: async () => {
      await h.db.query(
        "UPDATE feishu_notification_settings SET version=7 WHERE type='linxi_ledger_operate'",
      );
    },
  });
  const digest = h.get(NotificationDigestsService);
  await digest.onModuleDestroy();
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
  const setWindow = async (
    type: NotificationType,
    sendWindow: NotificationWindow | null,
  ) => {
    const row = (await settings()).find((s) => s.type === type)!;
    return h.call<Setting>(admin, 'PUT', `/system/notifications/${type}`, {
      enabled: row.enabled,
      version: row.version,
      sendWindow,
    });
  };
  const fixtureWindow = async () =>
    (
      await h.db.query<NotificationWindow[]>(`SELECT
    to_char((now() AT TIME ZONE 'Asia/Shanghai')+interval '2 hours','HH24:MI') AS start,
    to_char((now() AT TIME ZONE 'Asia/Shanghai')+interval '3 hours','HH24:MI') AS end`)
    )[0];
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
      const upgraded = await settings();
      assert.equal(upgraded.length, 9);
      assert(upgraded.every((row) => row.sendWindow === null));
      assert.equal(
        upgraded.find((row) => row.type === 'linxi_ledger_operate')?.version,
        7,
      );
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
    'only the first unassigned customer message creates a batch, including after the old 30-second window',
    async () => {
      await h.db.query(
        "UPDATE whatsapp_notification_windows SET next_at=now()-interval '1 hour'",
      );
      await incoming('second');
      await incoming('third');
      await due();
      await worker.drain();
      assert.equal(sent.length, 2);
      assert(
        sent.every((msg) =>
          msg.text.includes('请使用独立站账号登录系统，为该客户分配负责人。'),
        ),
      );
      const [count] = await h.db.query<{ n: number }[]>(
        "SELECT count(*)::int n FROM whatsapp_notification_batches WHERE conversation_id=$1 AND type='whatsapp_unassigned'",
        [c.id],
      );
      assert.equal(count.n, 1);
    },
  );
  await check(
    'assignment consumes pending manager messages and sends one immediate handoff',
    async () => {
      await incoming('before-assignment');
      await assign(a);
      await worker.drain();
      assert.equal(sent.length, 3);
      assert.equal(sent.at(-1)?.openId, 'ou_a');
      assert(sent.at(-1)?.text.includes('分配提醒'));
      await due();
      await worker.drain();
      assert.equal(sent.length, 3);
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
    'daily and overnight time boundaries, invalid pairs, stale saves and old toggle payloads',
    async () => {
      const window = { start: '21:00', end: '08:00' };
      const result = await setWindow('whatsapp_message', window);
      assert.deepEqual(result.sendWindow, window);
      assert.deepEqual(
        (await toggle('whatsapp_message', true)).sendWindow,
        window,
      );
      for (const invalid of [
        { start: '24:00', end: '08:00' },
        { start: '9:00', end: '17:00' },
        { start: '00:00', end: '00:00' },
        { start: '10:00' },
        { start: '10:00', end: '12:00', extra: 1 },
        [],
      ])
        await h.call(
          admin,
          'PUT',
          '/system/notifications/whatsapp_message',
          { enabled: true, version: result.version + 1, sendWindow: invalid },
          400,
          'VALIDATION_ERROR',
        );
      await h.call(
        admin,
        'PUT',
        '/system/notifications/whatsapp_message',
        { enabled: true, version: result.version, sendWindow: null },
        409,
        'CONFLICT',
      );
      const [bounds] = await h.db.query<
        { open: boolean; end: boolean; night: boolean; day: boolean }[]
      >(`SELECT
        feishu_window_resume('09:00','18:00','2026-11-25 09:00+08') IS NULL AS open,
        feishu_window_resume('09:00','18:00','2026-11-25 18:00+08')='2026-11-26 09:00+08'::timestamptz AS end,
        feishu_window_resume('21:00','08:00','2026-11-25 00:00+08') IS NULL AS night,
        feishu_window_resume('21:00','08:00','2026-11-25 08:00+08')='2026-11-25 21:00+08'::timestamptz AS day`);
      assert(Object.values(bounds).every(Boolean));
      assert.equal(
        (await setWindow('whatsapp_message', null)).sendWindow,
        null,
      );
    },
  );
  await check(
    'quiet messages coalesce by consultation and recipient, partial shared reads and oldest receipt use actual send time',
    async () => {
      // Route both consultations to the same recipient.
      await assign(b);
      await incoming('digest-second-contact', 'ZZ.digest');
      const [other] = await h.db.query<{ id: string }[]>(
        "SELECT c.id FROM whatsapp_conversations c JOIN whatsapp_contacts p ON p.id=c.contact_id WHERE p.bsuid='ZZ.digest'",
      );
      const chat = await h.call<Conversation>(
        manager,
        'GET',
        `/whatsapp/conversations/${other.id}`,
      );
      await h.call(
        manager,
        'POST',
        `/whatsapp/conversations/${other.id}/assign`,
        { ownerId: b.id, version: chat.version },
      );
      await worker.drain();
      await setWindow('whatsapp_message', await fixtureWindow());
      const before = sent.length;
      const now = Date.now();
      for (const [id, hours] of [
        ['r1', 5],
        ['r2', 3],
        ['r3', 2],
      ] as const)
        await incoming(id, 'ZZ.digest', { Timestamp: now - hours * 3600000 });
      await incoming('r4', 'ZZ.linked', { Timestamp: now - 3600000 });
      const [message] = await h.db.query<{ seq: string }[]>(
        "SELECT seq FROM whatsapp_messages WHERE provider_id='r1'",
      );
      await h.call(b, 'POST', `/whatsapp/conversations/${other.id}/read`, {
        lastSeq: message.seq,
      });
      await worker.drain();
      await digest.drain();
      assert.equal(sent.length, before);
      const [queued] = await h.db.query<{ n: number }[]>(
        "SELECT count(*)::int n FROM feishu_pending_digest_items WHERE open_id='ou_b' AND type='whatsapp_message'",
      );
      assert.equal(queued.n, 2);
      await setWindow('whatsapp_message', null);
      await Promise.all([digest.drain(), digest.drain()]);
      assert.equal(sent.length, before + 1);
      assert.match(
        sent.at(-1)!.text,
        /你有 3 条 WhatsApp 客户消息未读，最早一条是 3 小时 0 分钟前收到的/,
      );
      assert.match(
        sent.at(-1)!.text,
        /查看 WhatsApp 收件箱：https:\/\/example.test\/whatsapp\/inbox/,
      );
      await digest.drain();
      assert.equal(sent.length, before + 1);
    },
  );
  await check(
    'mixed due types share one generic digest, duplicate bindings count one ledger, known rejection retries its UUID',
    async () => {
      const quiet = await fixtureWindow();
      await setWindow('website_ledger_review', quiet);
      await setWindow('inquiry_follow_up', quiet);
      const [inq] = await h.db.query<{ id: string; owner_id: string }[]>(
        "SELECT id,owner_id FROM inquiries WHERE code='INQ-NOTIFY'",
      );
      await h.db.query(
        "UPDATE users SET feishu_open_id='ou_manager' WHERE id=$1",
        [inq.owner_id],
      );
      const follow = await h.db.transaction((m) =>
        appendFollowUp(
          m,
          inq.id,
          {
            remark: 'Scheduled digest',
            nextFollowUpAt: new Date(
              Date.now() + 86400000 + 600000,
            ).toISOString(),
            reminderDays: 1,
          },
          { id: inq.owner_id, name: 'Synthetic' },
        ),
      );
      const [scheduled] = await h.db.query<{ digest_at: Date | null }[]>(
        'SELECT digest_at FROM inquiry_follow_up_reminders WHERE follow_up_id=$1',
        [follow],
      );
      assert(scheduled.digest_at);
      await h.db.query(
        "UPDATE inquiry_follow_up_reminders SET due_at=now()-interval '90 minutes' WHERE follow_up_id=$1",
        [follow],
      );
      const [row] = await h.db.query<LedgerReminderRow[]>(
        `INSERT INTO direct_ledgers(business_unit,received_date,source,creator_id,creator_name,receiving_account_name,operator_id,operator_name,loss,updated_by)
      VALUES('website',current_date,'digest',$1,'Synthetic','独立站',$1,'Synthetic',true,$1)
      RETURNING id,version,business_unit AS "businessUnit",operator_id AS "operatorId",loss,reviewed_at AS "reviewedAt",operated,proposal_sent AS "proposalSent",order_status AS "orderStatus"`,
        [a.id],
      );
      await h.db.transaction((m) =>
        h.get(LedgerNotificationsService).enqueue(m, row),
      );
      await setWindow('website_ledger_review', null);
      await setWindow('inquiry_follow_up', null);
      await h.db.query("UPDATE users SET status='disabled' WHERE id=$1", [
        manager2.id,
      ]);
      const uuids: string[] = [];
      feishu.sendText = (openId, text, uuid) => {
        uuids.push(uuid);
        if (uuids.length === 1)
          return Promise.reject(new FeishuSendException(false));
        return send(openId, text, uuid);
      };
      const before = sent.length;
      for (let tick = 0; tick < 4; tick++) {
        await h.db.query(
          "UPDATE feishu_notification_digests SET claimed_at=now()-interval '5 seconds',retry_at=now() WHERE status<>'sending'",
        );
        await digest.drain();
      }
      feishu.sendText = send;
      assert.equal(uuids.length, 2);
      assert.equal(uuids[0], uuids[1]);
      assert.equal(sent.length, before + 1);
      const message = sent.at(-1)!;
      assert.equal(message.openId, 'ou_manager');
      assert.match(message.text, /独立站台账待审核 1 笔/);
      assert.match(message.text, /询盘跟进提醒 1 个/);
      assert.match(message.text, /1 小时 30 分钟前的询盘跟进提醒/);
      assert.equal(
        (
          await h.db.query<{ status: string }[]>(
            'SELECT status FROM inquiry_follow_up_reminders WHERE follow_up_id=$1',
            [follow],
          )
        )[0].status,
        'sent',
      );
      await h.db.query("UPDATE users SET status='enabled' WHERE id=$1", [
        manager2.id,
      ]);
    },
  );
  await check(
    'all read messages and a reassigned consultation produce no stale digest',
    async () => {
      await setWindow('whatsapp_message', await fixtureWindow());
      await incoming('digest-read', 'ZZ.digest');
      await incoming('digest-transferred', 'ZZ.linked');
      const [msg] = await h.db.query<
        { seq: string; conversation_id: string }[]
      >(
        "SELECT seq,conversation_id FROM whatsapp_messages WHERE provider_id='digest-read'",
      );
      await h.call(
        b,
        'POST',
        `/whatsapp/conversations/${msg.conversation_id}/read`,
        { lastSeq: msg.seq },
      );
      await assign(a);
      await setWindow('whatsapp_message', null);
      const before = sent.length;
      await h.db.query(
        "UPDATE feishu_notification_digests SET claimed_at=now()-interval '5 seconds'",
      );
      await digest.drain();
      assert.equal(sent.length, before);
      const [pending] = await h.db.query<{ n: number }[]>(
        "SELECT count(*)::int n FROM feishu_pending_digest_items WHERE type='whatsapp_message'",
      );
      assert.equal(pending.n, 0);
    },
  );
  await check(
    'a digest with unknown remote outcome never sends again, including after a worker restart',
    async () => {
      await setWindow('whatsapp_message', await fixtureWindow());
      await incoming('unknown-digest', 'ZZ.digest');
      const [id] = await h.db.query<{ id: string }[]>(
        "SELECT id FROM feishu_pending_digest_items WHERE open_id='ou_b'",
      );
      assert(id);
      await setWindow('whatsapp_message', null);
      await h.db.query(
        "UPDATE feishu_notification_digests SET claimed_at=now()-interval '5 seconds'",
      );
      let calls = 0;
      feishu.sendText = () => {
        calls++;
        return Promise.reject(new FeishuSendException(true));
      };
      await digest.drain();
      assert.equal(calls, 1);
      assert.equal(
        (
          await h.db.query<{ status: string }[]>(
            'SELECT status FROM whatsapp_notification_deliveries WHERE id=$1',
            [id.id],
          )
        )[0].status,
        'unknown',
      );
      feishu.sendText = send;
      const before = sent.length;
      const restarted = new NotificationDigestsService(h.db, feishu);
      await restarted.drain();
      assert.equal(sent.length, before);
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
      const runner = h.db.createQueryRunner();
      try {
        await assert.rejects(
          new FeishuNotificationWindows1796256021000().down(runner),
          /Retain notification/,
        );
      } finally {
        await runner.release();
      }
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
