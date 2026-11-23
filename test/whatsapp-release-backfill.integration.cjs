'use strict';

const assert = require('node:assert/strict');
const { IsolationHarness } = require('./business-isolation.harness.ts');
const { WhatsappEvents } = require('../src/whatsapp/whatsapp.events.ts');
const { AddWhatsappReleaseBackfill1796256012000 } = require('../src/migrations/1796256012000-AddWhatsappReleaseBackfill.ts');
const { reconcile } = require('../ops/whatsapp-backfill/reconcile.cjs');
const { makeListPage } = require('../ops/whatsapp-backfill/main.cjs');

const h = new IsolationHarness({
  WHATSAPP_CHAT_ENABLED: 'true', WHATSAPP_CHAT_RECEIVE_MODE: 'http', WHATSAPP_CHAT_WORKER_ENABLED: 'false',
  WHATSAPP_CHAT_HTTP_TOKEN: 'synthetic-backfill-http-token-only', WHATSAPP_CHAT_ENVIRONMENT: 'test',
  WHATSAPP_CHAT_SPACE_ID: 'test-space', WHATSAPP_CHAT_WABA_ID: 'test-waba', WHATSAPP_CHAT_PHONE: '0000000000',
});

async function main() {
  await h.start();
  const runner = h.db.createQueryRunner();
  const db = await runner.connect();
  try {
    const events = h.get(WhatsappEvents);
    const account = await events.account();
    const actor = await h.actor('website', 'BUSINESS_MANAGER');
    const end = Date.now() - 6000;
    const window = { start: end - 120_000, end };
    const sender = '0000000011';
    const callback = (id, time, text = id) => ({
      MessageId: id, To: account.phone, From: sender, Type: 'text', Message: text, Timestamp: time,
    });
    const row = (id, time = end - 1000, extra = {}) => ({
      businessNumber: account.phone, eventAction: 'UP', channelType: 'WHATSAPP', type: 'message',
      userNumber: sender, messageType: 'TEXT', messageId: id, sendTime: new Date(time).toISOString(),
      message: JSON.stringify({ text: id }), ...extra,
    });
    const count = async (sql, args = []) => (await db.query(sql, args)).rows[0].n;
    const messageCount = id => count('SELECT count(*)::int AS n FROM whatsapp_messages WHERE provider_id=$1', [id]);
    const summary = () => h.call(actor, 'GET', '/whatsapp/summary');

    // Apply the actual migration to a prior schema that already has a received message.
    const migration = new AddWhatsappReleaseBackfill1796256012000();
    await migration.down(runner);
    await db.query('DELETE FROM migrations WHERE name=$1', [migration.constructor.name]);
    await events.receive(callback('already', end - 100), 'inbound');
    assert(await events.processOne());
    assert.equal((await h.db.runMigrations()).length, 1);
    assert.equal((await h.db.runMigrations()).length, 0);
    assert.equal(await messageCount('already'), 1);
    await events.receive(callback('original-pending', end - 7000), 'inbound');
    const before = await summary();

    const rows = [row('already'), row('original-pending'), row('missed', end - 10_000, {
      message: JSON.stringify({ text: '  original\ntext  ' }), uniqueMessageId: 'wamid.missed',
    }), row('image', end - 2000, { messageType: 'IMAGE' }),
    row('reply', end - 1000, { message: JSON.stringify({ text: 'quote', context: { id: 'wamid.parent' } }) }),
    row('unknown-sender', end, { userNumber: '' })];
    const listPage = makeListPage({
      async listChatappMessageWithOptions(q) {
        assert.equal(q.eventAction, 'UP');
        assert.equal(q.channelType, 'WHATSAPP');
        assert.equal(q.custSpaceId, account.spaceId);
        assert.equal(q.businessNumber, account.phone);
        assert.equal(q.page.size, 100);
        assert.equal(q.startTime, window.start - 600_000);
        assert.equal(q.endTime, end);
        return { body: { code: 'OK', success: true, data: rows } };
      },
    });
    const [initial] = await reconcile(db, account, 'frontend-101-1', window, listPage);
    assert.deepEqual([initial.scanned, initial.queued, initial.review, initial.pending], [6, 1, 3, 1]);
    while (await events.processOne()) { /* drain only synthetic events */ }
    assert.equal((await summary()).unreadCount, before.unreadCount + 2);
    const stored = (await db.query(`SELECT m.text,m.occurred_at,c.last_inbound_at,m.conversation_id
      FROM whatsapp_messages m JOIN whatsapp_conversations v ON m.conversation_id=v.id
      JOIN whatsapp_contacts c ON c.id=v.contact_id WHERE m.provider_id='missed'`)).rows[0];
    assert.equal(stored.text, '  original\ntext  ');
    assert.equal(stored.occurred_at.getTime(), end - 10_000);
    assert.equal(stored.last_inbound_at.getTime(), end - 100);
    assert.equal(await messageCount('image'), 0);
    assert.equal(await messageCount('reply'), 0);
    console.log('PASS pre-existing database upgrade, original time, unread, normal worker and review list');

    // Repeat the release and deliver the original callback after recovery.
    const noFetch = () => { throw new Error('Unexpected cloud request'); };
    const [repeat] = await reconcile(db, account, 'frontend-101-1', null, noFetch);
    assert.equal(repeat.recovered, 1);
    const notices = () => count('SELECT coalesce(sum(message_count),0)::int AS n FROM whatsapp_notification_batches');
    const noticeCount = await notices();
    await events.receive({ ...callback('missed', end - 10_000, stored.text), Context: { id: 'wamid.original' } }, 'inbound');
    assert(await events.processOne());
    assert.equal(await messageCount('missed'), 1);
    assert.equal((await summary()).unreadCount, before.unreadCount + 2);
    assert.equal(await notices(), noticeCount);
    const context = (await db.query("SELECT attachment->>'contextMessageId' AS id FROM whatsapp_messages WHERE provider_id='missed'")).rows[0];
    assert.equal(context.id, 'wamid.original');
    console.log('PASS repeat release and late callback preserve one message, unread and notification');

    // Fail on page two, then resume the saved window, including the previous scan's overlap.
    const batch = Array.from({ length: 100 }, (_, n) => row('page-' + n));
    const nextWindow = { start: end + 500, end: end + 1000 };
    await assert.rejects(reconcile(db, account, 'backend-102-1', nextWindow,
      async (_account, from, until, page) => {
        assert.equal(from, end - 600_000);
        assert.equal(until, nextWindow.end);
        if (page === 2) throw new Error('PROVIDER_TIMEOUT');
        return batch;
      }), /PROVIDER_TIMEOUT/);
    assert.equal(await count("SELECT count(*)::int AS n FROM whatsapp_events WHERE event_key LIKE 'release-backfill:page-%'"), 0);
    assert.equal(await count('SELECT count(*)::int AS n FROM whatsapp_backfill_runs WHERE finished_at IS NULL'), 1);
    await db.query('UPDATE whatsapp_runtime_settings SET inbound_enabled=false');
    const [resumed] = await reconcile(db, account, 'backend-102-1', null,
      async (_a, _s, _e, page) => page === 1 ? batch : [row('page-last', end, { message: 'plain text' }), row('missed')]);
    assert.deepEqual([resumed.scanned, resumed.queued, resumed.pending], [102, 101, 101]);
    assert.equal(await events.processOne(), false);
    await db.query('UPDATE whatsapp_runtime_settings SET inbound_enabled=true');
    while (await events.processOne()) { /* now the inbox can consume the batch */ }
    assert.equal(await messageCount('page-last'), 1);
    assert.equal((await reconcile(db, account, 'backend-102-1', null, noFetch))[0].recovered, 101);
    console.log('PASS full pagination, partial failure, independent retry, paused receiving and overlap');

    // Filtering is verified on the actual response as well as the request.
    await assert.rejects(reconcile(db, account, 'frontend-103-1',
      { start: end + 1100, end: end + 1300 }, async () => [row('wrong-account', end, { businessNumber: '0000000022' })]),
    /PROVIDER_ACCOUNT_OR_DIRECTION_MISMATCH/);
    assert.equal(await messageCount('wrong-account'), 0);
    await assert.rejects(reconcile(db, account, 'frontend-103-1', null,
      makeListPage({ listChatappMessageWithOptions: async () => ({ body: { code: 'ERROR', data: [] } }) })),
    /PROVIDER_LIST_FAILED/);
    assert.equal((await reconcile(db, account, 'frontend-103-1', null, async () => []))[0].scanned_all, true);
    console.log('PASS account isolation and supplier failures never advance coverage');

    const later = end + 8 * 3600_000;
    let slices = 0;
    await assert.rejects(reconcile(db, account, 'backend-104-1', { start: later - 60_000, end: later },
      async () => { if (++slices === 2) throw new Error('INTERRUPTED'); return []; }, later), /INTERRUPTED/);
    const saved = (await db.query("SELECT next_at FROM whatsapp_backfill_runs WHERE release_key='backend-104-1'")).rows[0];
    const starts = [];
    const continued = await reconcile(db, account, 'frontend-105-1', { start: later, end: later + 2000 },
      async (_account, start) => { starts.push(start); return []; }, later + 2000);
    assert.deepEqual(starts, [saved.next_at.getTime(), later - 600_000]);
    assert.deepEqual(continued.map(r => [r.release, r.scanned_all]), [['backend-104-1', true], ['frontend-105-1', true]]);
    await assert.rejects(migration.down(runner), /Refusing rollback with WhatsApp backfill history/);
    console.log('PASS next release resumes from committed slice and retained operational history');

    const devAccount = { ...account, recipients: [sender, 'ZZ.synthetic'] };
    const devKey = 'backend-106-1';
    const devWindow = { start: end + 2000, end: end + 4000 };
    const devRow = row('dev-missed', end + 3000);
    const offList = row('outside-dev', end + 3000, { userNumber: '0000000033' });
    await assert.rejects(reconcile(db, devAccount, devKey, devWindow, async () => [devRow, offList]),
      /DEV_TEST_CONTACT_MISMATCH/);
    assert.equal(await count("SELECT count(*)::int AS n FROM whatsapp_events WHERE event_key IN ('release-backfill:outside-dev','release-backfill:dev-missed')"), 0);
    const filters = [];
    const devList = makeListPage({ async listChatappMessageWithOptions(query) {
      filters.push(query.userNumber);
      return { body: { code: 'OK', data: query.userNumber === sender ? [devRow, devRow] : [] } };
    } });
    const [devRun] = await reconcile(db, devAccount, devKey, devWindow, devList);
    assert.deepEqual(filters, devAccount.recipients);
    assert.deepEqual([devRun.scanned, devRun.queued], [2, 1]);
    assert(await events.processOne());
    for (const retryWindow of [devWindow, null]) {
      const [receipt] = await reconcile(db, devAccount, devKey, retryWindow, noFetch);
      assert.deepEqual([receipt.queued, receipt.recovered], [1, 1]);
    }
    assert.equal(await count('SELECT count(*)::int AS n FROM whatsapp_backfill_runs WHERE release_key=$1', [devKey]), 1);
    assert.equal(await messageCount('dev-missed'), 1);
    assert.equal(await messageCount('outside-dev'), 0);
    console.log('PASS dev test-contact queries, off-list rejection, one release scan and one message after replay');
  } finally {
    await runner.release();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => h.close());
