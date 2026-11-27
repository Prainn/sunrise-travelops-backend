import assert from 'node:assert/strict';
import {
  FeishuSendException,
  FeishuService,
} from '../src/feishu/feishu.service';
import type { RemoteMail } from '../src/mail/alimail.provider';
import { MailNotificationsService } from '../src/mail/mail-notifications.service';
import { MailSync } from '../src/mail/mail.sync';
import { MAILBOX } from '../src/mail/mail.types';
import { NotificationDigestsService } from '../src/notifications/notification-digests.service';
import type { NotificationWindow } from '../src/notifications/notification-settings';
import { IsolationHarness } from './business-isolation.harness';

const h = new IsolationHarness(
  { FEISHU_WEB_BASE_URL: 'https://example.test' },
  { mail: true },
);

async function main() {
  await h.start({
    from: 1796256028000,
    seed: async () => {
      await h.db.query(
        `INSERT INTO mail_sync(mailbox,folder,start_at,floor_at)
        VALUES($1,'2',now()-interval '2 days',now()-interval '2 days')`,
        [MAILBOX],
      );
    },
  });
  assert.equal((await h.db.runMigrations()).length, 0);
  const worker = h.get(MailNotificationsService);
  const digest = h.get(NotificationDigestsService);
  await worker.onModuleDestroy();
  await digest.onModuleDestroy();
  const feishu = h.get(FeishuService);
  Object.defineProperty(feishu, 'configured', { get: () => true });
  const sends: { openId: string; text: string; uuid: string }[] = [];
  let failure: Error | null = null;
  feishu.sendText = (openId, text, uuid) => {
    sends.push({ openId, text, uuid });
    if (failure) return Promise.reject(failure);
    return Promise.resolve({ messageId: `synthetic-${uuid}` });
  };
  const manager = await h.actor('website', 'BUSINESS_MANAGER');
  const duplicateManager = await h.actor('website', 'BUSINESS_MANAGER');
  const revoked = await h.actor('website', 'BUSINESS_MANAGER');
  await h.actor('website', 'BUSINESS_MANAGER');
  const coordinator = await h.actor('website');
  const unrelated = await h.actor('linxi', 'BUSINESS_MANAGER');
  const root = await h.actor('headquarters', 'ROOT', null, undefined, 'mango');
  for (const [id, openId] of [
    [manager.id, 'ou_mail_manager'],
    [duplicateManager.id, 'ou_mail_manager'],
    [revoked.id, 'ou_mail_revoked'],
    [coordinator.id, 'ou_mail_coordinator'],
    [unrelated.id, 'ou_mail_unrelated'],
    [root.id, 'ou_mail_root'],
  ])
    await h.db.query('UPDATE users SET feishu_open_id=$2 WHERE id=$1', [
      id,
      openId,
    ]);

  const sync = h.get(MailSync);
  const remote = (id: string, refs: string[] = []): RemoteMail => ({
    providerId: id,
    internetId: `${id}@example.test`,
    refs,
    subject: '云南行程咨询',
    sender: { email: 'customer@example.test', name: '测试客户' },
    recipients: [{ email: MAILBOX }],
    cc: [],
    replyTo: [],
    body: 'Synthetic body, never copied to Feishu',
    occurredAt: new Date(),
    isRead: false,
    attachments: [],
  });
  const ingest = async (mail: RemoteMail, inbound = true) => {
    await h.db.transaction((m) => sync.ingest(m, mail, inbound));
    const [row] = await h.db.query<{ threadId: string; messageId: string }[]>(
      'SELECT thread_id AS "threadId",id AS "messageId" FROM mail_messages WHERE provider_id=$1',
      [mail.providerId],
    );
    assert(row);
    return row;
  };
  const deliveries = (thread: string) =>
    h.db.query<
      {
        id: string;
        open_id: string;
        status: string;
        error_code: string | null;
        digest_at: Date | null;
      }[]
    >(
      'SELECT id,open_id,status,error_code,digest_at FROM mail_notification_deliveries WHERE thread_id=$1 ORDER BY open_id',
      [thread],
    );
  const setting = async () => {
    const rows = await h.call<
      { type: string; enabled: boolean; version: number }[]
    >(root, 'GET', '/system/notifications');
    const row = rows.find((entry) => entry.type === 'mail_unassigned');
    assert(row);
    return row;
  };
  const configure = async (body: {
    enabled?: boolean;
    sendWindow?: NotificationWindow | null;
  }) => {
    const { version, enabled } = await setting();
    await h.call(root, 'PUT', '/system/notifications/mail_unassigned', {
      version,
      enabled,
      ...body,
    });
  };
  const assign = (thread: string) =>
    h.call(
      manager,
      'POST',
      `/mail/threads/${thread}/assign`,
      { ownerId: coordinator.id, version: 1 },
      201,
    );

  assert.equal((await setting()).enabled, true);
  const older = await ingest({
    ...remote('older'),
    occurredAt: new Date(Date.now() - 86400000),
  });
  assert.equal((await deliveries(older.threadId)).length, 0);
  const first = remote('first');
  const fresh = await ingest(first);
  const follow = await ingest(remote('follow', [first.internetId!]));
  assert.equal(follow.threadId, fresh.threadId);
  await ingest(first);
  assert.deepEqual(
    (await deliveries(fresh.threadId)).map((row) => row.open_id),
    ['ou_mail_manager', 'ou_mail_revoked'],
  );
  await h.db.query("UPDATE users SET feishu_open_id='' WHERE id=$1", [
    revoked.id,
  ]);
  await Promise.all([worker.drain(), worker.drain()]);
  assert.equal(sends.length, 1);
  assert.match(sends[0].text, /【邮件待分配】[\s\S]*云南行程咨询/);
  assert.doesNotMatch(sends[0].text, /Synthetic body/);
  const url = new URL(sends[0].text.split('查看会话：')[1]);
  assert.equal(url.pathname, '/website-inquiries/mail');
  assert.equal(url.searchParams.get('mailbox'), MAILBOX);
  assert.equal(url.searchParams.get('thread'), fresh.threadId);
  assert.equal(url.searchParams.get('message'), fresh.messageId);
  assert.deepEqual(
    (await deliveries(fresh.threadId)).map((row) => row.status),
    ['sent', 'skipped'],
  );

  const outbound = {
    ...remote('sent-first', ['yet-unseen@example.test']),
    sender: { email: MAILBOX },
  };
  const outboundRecord = await ingest(outbound, false);
  assert.equal((await deliveries(outboundRecord.threadId)).length, 0);
  const laterInbound = await ingest(remote('yet-unseen'));
  assert.equal(laterInbound.threadId, outboundRecord.threadId);
  await assign(laterInbound.threadId);
  await worker.drain();
  assert.equal(sends.length, 1);
  assert.equal(
    (await deliveries(laterInbound.threadId))[0].error_code,
    'ASSIGNMENT_CHANGED',
  );

  const waiting = await ingest(remote('waiting'));
  await configure({ enabled: false });
  const disabled = remote('disabled');
  const whileOff = await ingest(disabled);
  await configure({ enabled: true });
  await ingest(remote('after-enable-reply', [disabled.internetId!]));
  await worker.drain();
  assert.equal(sends.length, 1);
  assert.equal((await deliveries(whileOff.threadId)).length, 0);
  assert.equal(
    (await deliveries(waiting.threadId))[0].error_code,
    'NOTIFICATION_DISABLED',
  );

  const [window] = await h.db.query<NotificationWindow[]>(`SELECT
    to_char((now() AT TIME ZONE 'Asia/Shanghai')+interval '2 hours','HH24:MI') AS start,
    to_char((now() AT TIME ZONE 'Asia/Shanghai')+interval '3 hours','HH24:MI') AS end`);
  await configure({ sendWindow: window });
  const quietFirst = await ingest(remote('quiet-1'));
  const quietSecond = await ingest(remote('quiet-2'));
  const quietAssigned = await ingest(remote('quiet-assigned'));
  await assign(quietAssigned.threadId);
  await worker.drain();
  assert.equal(sends.length, 1);
  assert((await deliveries(quietSecond.threadId))[0].digest_at);
  const [visible] = await h.db.query<{ previous: boolean; current: boolean }[]>(
    `SELECT EXISTS(SELECT 1 FROM feishu_pending_digest_items WHERE subject_id=$1) AS previous,
      EXISTS(SELECT 1 FROM feishu_pending_digest_items_with_mail WHERE subject_id=$1 AND type='mail_unassigned') AS current`,
    [quietSecond.threadId],
  );
  assert.deepEqual(visible, { previous: false, current: true });
  await configure({ sendWindow: null });
  await digest.drain();
  assert.equal(sends.length, 2);
  assert.match(sends[1].text, /邮件会话待分配 2 个/);
  assert.equal((await deliveries(quietFirst.threadId))[0].status, 'sent');
  assert.equal((await deliveries(quietAssigned.threadId))[0].status, 'skipped');

  const retry = await ingest(remote('retry'));
  failure = new FeishuSendException(false);
  await worker.drain();
  const [retryJob] = await deliveries(retry.threadId);
  assert.equal(retryJob.status, 'pending');
  await h.db.query(
    'UPDATE mail_notification_deliveries SET next_attempt_at=now() WHERE id=$1',
    [retryJob.id],
  );
  failure = null;
  await worker.drain();
  assert.equal((await deliveries(retry.threadId))[0].status, 'sent');
  assert.deepEqual(
    sends.slice(-2).map((send) => send.uuid),
    [retryJob.id, retryJob.id],
  );
  const uncertain = await ingest(remote('uncertain'));
  failure = new FeishuSendException(true);
  await worker.drain();
  const attempts = sends.length;
  await worker.drain();
  assert.equal((await deliveries(uncertain.threadId))[0].status, 'unknown');
  assert.equal(sends.length, attempts);
  console.log(
    'Mail Feishu notifications passed: migration, first inbound only, recipient scopes, links, assignment, switch, digest, retries and unknown outcomes.',
  );
}

void main()
  .finally(() => h.close())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
