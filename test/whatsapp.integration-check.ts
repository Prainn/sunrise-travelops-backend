/** Isolated local PostgreSQL only; mock sends, no cloud credentials or real customer data. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CreateWhatsappWorkbench1795651200000 } from '../src/migrations/1795651200000-CreateWhatsappWorkbench';
import { Actor, IsolationHarness, Page } from './business-isolation.harness';
import { WhatsappEvents } from '../src/whatsapp/whatsapp.events';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { WhatsappProvider } from '../src/whatsapp/whatsapp.provider';
import { ChatMessage, Conversation } from '../src/whatsapp/whatsapp.types';
const config = {
  WHATSAPP_CHAT_ENABLED: 'true',
  WHATSAPP_CHAT_WORKER_ENABLED: 'false',
  WHATSAPP_CHAT_RECEIVE_MODE: 'http',
  WHATSAPP_CHAT_SEND_ENABLED: 'true',
  WHATSAPP_CHAT_ENVIRONMENT: 'test',
  WHATSAPP_CHAT_SPACE_ID: 'test-space',
  WHATSAPP_CHAT_WABA_ID: 'test-waba',
  WHATSAPP_CHAT_PHONE: '0000000000',
  WHATSAPP_CHAT_TEST_RECIPIENTS: 'ZZ.synthetic-contact',
  WHATSAPP_CHAT_HTTP_TOKEN: 'test-only-http-ingress-token-not-a-production-key',
  WHATSAPP_CHAT_SOURCE_TOKEN:
    'test-only-source-link-token-not-a-production-key',
};
const h = new IsolationHarness(config);
async function undoWhatsappMigration() {
  // Dev may contain newer migrations; only undo this feature in the disposable DB.
  assert.match(String(h.db.options.database), /^travelops_isolation_/);
  await h.db.transaction(async (manager) => {
    assert(manager.queryRunner);
    await new CreateWhatsappWorkbench1795651200000().down(manager.queryRunner);
    await manager.query('DELETE FROM migrations WHERE name=$1', [
      'CreateWhatsappWorkbench1795651200000',
    ]);
  });
}
async function call<T = Record<string, unknown>>(
  actor: Actor | undefined,
  method: string,
  path: string,
  body?: unknown,
  status?: number,
  code?: string,
): Promise<T> {
  const expected =
    status ??
    (method === 'POST' &&
    !/(assign|state|read|convert)$/.test(path) &&
    !path.includes('/ingress/')
      ? 201
      : 200);
  return h.call<T>(
    actor,
    method,
    path,
    body,
    expected,
    code ?? (expected >= 400 ? 'VALIDATION_ERROR' : 'SUCCESS'),
  );
}
let checks = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  console.log(`PASS ${++checks}: ${name}`);
}
async function main() {
  await h.start();
  const events = h.get(WhatsappEvents),
    service = h.get(WhatsappService),
    provider = h.get(WhatsappProvider);
  const manager = await h.actor('website', 'BUSINESS_MANAGER'),
    a = await h.actor('website'),
    b = await h.actor('website');
  const other = await h.actor('linxi', 'BUSINESS_MANAGER');
  let root = await h.actor('headquarters', 'ROOT');
  const payload = (id: string, extra: Record<string, unknown> = {}) => ({
    MessageId: id,
    CustSpaceId: 'test-space',
    WabaId: 'test-waba',
    FromUserId: 'ZZ.synthetic-contact',
    From: 'ZZ.synthetic-contact',
    To: '0000000000',
    Name: 'Synthetic customer',
    Type: 'TEXT',
    Message: 'Synthetic inquiry',
    Timestamp: Date.now(),
    ...extra,
  });
  const page = () =>
    call<Page<Conversation>>(manager, 'GET', '/whatsapp/conversations');
  let c: Conversation,
    message: ChatMessage,
    inquiryId: string,
    ledgerId: string;
  const refresh = async () => {
    c = await call<Conversation>(
      manager,
      'GET',
      `/whatsapp/conversations/${c.id}`,
    );
    return c;
  };
  await check(
    'migration rollback on empty WhatsApp data, representative old inquiry survives upgrade and repeat run',
    async () => {
      await undoWhatsappMigration();
      const [country] = await h.db.query<{ id: string }[]>(
        `SELECT id FROM system_business_dictionary_items WHERE code='UNKNOWN' LIMIT 1`,
      );
      assert(country);
      const old = await call<{ id: string }>(a, 'POST', '/website/inquiries', {
        countryItemId: country.id,
        customerName: 'Synthetic baseline',
        plannedDays: 1,
        requirements: 'Synthetic baseline',
      });
      assert.equal((await h.db.runMigrations()).length, 1);
      assert.equal((await h.db.runMigrations()).length, 0);
      assert.equal(
        (await call<{ id: string }>(a, 'GET', `/website/inquiries/${old.id}`))
          .id,
        old.id,
      );
    },
  );
  await check(
    'incoming batch and exact redelivery persist one message, no automatic inquiry',
    async () => {
      const raw = payload('in-1');
      await events.receive([raw, raw], 'inbound');
      await events.processOne();
      assert.equal((await page()).total, 1);
      c = (await page()).list[0];
      assert.equal(c.inquiryId, null);
      assert.equal(
        (
          await call<Page<ChatMessage>>(
            manager,
            'GET',
            `/whatsapp/conversations/${c.id}/messages`,
          )
        ).total,
        1,
      );
      const [count] = await h.db.query<{ n: number }[]>(
        'SELECT count(*)::int n FROM whatsapp_contacts',
      );
      assert.equal(count.n, 1);
    },
  );
  await check(
    'unassigned and cross-business direct-ID isolation; reserved full account identity',
    async () => {
      assert.equal(
        (await call<Page>(a, 'GET', '/whatsapp/conversations')).total,
        0,
      );
      await call(
        a,
        'GET',
        `/whatsapp/conversations/${c.id}`,
        undefined,
        404,
        'NOT_FOUND',
      );
      await call(
        other,
        'GET',
        '/whatsapp/conversations',
        undefined,
        403,
        'AUTH_FORBIDDEN',
      );
      await call(
        root,
        'GET',
        '/whatsapp/conversations',
        undefined,
        403,
        'AUTH_FORBIDDEN',
      );
      for (const username of ['sunrise', 'mango']) {
        root = await h.actor('headquarters', 'ROOT', null, undefined, username);
        assert.equal(
          (await call<Page>(root, 'GET', '/whatsapp/conversations')).total,
          1,
        );
        await call(root, 'GET', '/whatsapp/integration');
      }
    },
  );
  await check(
    'supervisor assignment, stale version and owner-only reply visibility',
    async () => {
      await call(
        a,
        'POST',
        `/whatsapp/conversations/${c.id}/assign`,
        { version: c.version, ownerId: a.id, reason: 'Synthetic' },
        403,
        'AUTH_FORBIDDEN',
      );
      await call(manager, 'POST', `/whatsapp/conversations/${c.id}/assign`, {
        version: c.version,
        ownerId: a.id,
        reason: 'Synthetic',
      });
      await call(
        manager,
        'POST',
        `/whatsapp/conversations/${c.id}/assign`,
        { version: c.version, ownerId: b.id, reason: 'Synthetic' },
        409,
        'CONFLICT',
      );
      await refresh();
      await call(a, 'GET', `/whatsapp/conversations/${c.id}`);
      await call(
        b,
        'GET',
        `/whatsapp/conversations/${c.id}/messages`,
        undefined,
        404,
        'NOT_FOUND',
      );
    },
  );
  await check(
    'read position is explicit, per user and cannot reference another conversation',
    async () => {
      const messages = await call<Page<ChatMessage>>(
        a,
        'GET',
        `/whatsapp/conversations/${c.id}/messages`,
      );
      message = messages.list[0];
      assert.equal(
        (await call<Page>(a, 'GET', '/whatsapp/conversations?unread=true'))
          .total,
        1,
      );
      await call(manager, 'POST', `/whatsapp/conversations/${c.id}/read`, {
        lastSeq: message.seq,
      });
      assert.equal(
        (await call<Page>(a, 'GET', '/whatsapp/conversations?unread=true'))
          .total,
        1,
      );
      await call(a, 'POST', `/whatsapp/conversations/${c.id}/read`, {
        lastSeq: message.seq,
      });
      assert.equal(
        (await call<Page>(a, 'GET', '/whatsapp/conversations?unread=true'))
          .total,
        0,
      );
      await call(
        a,
        'POST',
        `/whatsapp/conversations/${c.id}/read`,
        { lastSeq: '9223372036854775808' },
        400,
        'VALIDATION_ERROR',
      );
    },
  );
  await check(
    'manual inquiry validates missing fields, prefills BSUID, atomic idempotent creation',
    async () => {
      const prefill = await call<{ input: { contactInfo: string } }>(
        a,
        'GET',
        `/whatsapp/conversations/${c.id}/inquiry-prefill`,
      );
      assert.equal(prefill.input.contactInfo, 'ZZ.synthetic-contact');
      await call(
        a,
        'POST',
        `/whatsapp/conversations/${c.id}/inquiry`,
        { version: c.version },
        400,
        'VALIDATION_ERROR',
      );
      const [country] = await h.db.query<{ id: string }[]>(
        `SELECT id FROM system_business_dictionary_items WHERE code='UNKNOWN' LIMIT 1`,
      );
      const input = {
        version: c.version,
        countryItemId: country.id,
        customerName: 'Synthetic customer',
        plannedDays: 1,
        requirements: 'Synthetic itinerary',
        whatsappSourceId: 'untrusted-client-reference',
      };
      const [first, second] = await Promise.all([
        call<{ inquiryId: string }>(
          a,
          'POST',
          `/whatsapp/conversations/${c.id}/inquiry`,
          input,
        ),
        call<{ inquiryId: string }>(
          a,
          'POST',
          `/whatsapp/conversations/${c.id}/inquiry`,
          input,
        ),
      ]);
      assert.equal(first.inquiryId, second.inquiryId);
      inquiryId = first.inquiryId;
      const [stored] = await h.db.query<{ whatsapp_source_id: string }[]>(
        'SELECT whatsapp_source_id FROM website_inquiries WHERE id=$1',
        [inquiryId],
      );
      assert.equal(stored.whatsapp_source_id, '');
      await refresh();
    },
  );
  await check(
    'reaction outbox validates target scope, keeps idempotency and dispatches actual reactions',
    async () => {
      const path = `/whatsapp/conversations/${c.id}/messages/${message.id}/reactions`;
      const input = { clientRequestId: randomUUID(), emoji: '👍' };
      await call(b, 'POST', path, input, 404, 'NOT_FOUND');
      await call(other, 'POST', path, input, 403, 'AUTH_FORBIDDEN');
      await call(a, 'POST', path, { ...input, emoji: 'not-an-emoji' }, 400);
      await call(
        a,
        'POST',
        `/whatsapp/conversations/${c.id}/messages/${randomUUID()}/reactions`,
        input,
        404,
        'NOT_FOUND',
      );
      const sent = await call<ChatMessage>(a, 'POST', path, input);
      assert.equal(sent.kind, 'reaction');
      assert.equal(sent.attachment?.targetMessageId, message.id);
      assert.equal(sent.attachment?.messageId, message.providerId);
      assert.equal(
        (await call<ChatMessage>(a, 'POST', path, input)).id,
        sent.id,
      );
      await call(a, 'POST', path, { ...input, emoji: '❤️' }, 409, 'CONFLICT');
      await call(
        a,
        'POST',
        `/whatsapp/conversations/${c.id}/messages`,
        { clientRequestId: input.clientRequestId, text: '👍' },
        409,
        'CONFLICT',
      );
      let sends = 0;
      provider.send = (_account, _recipient, text, taskId, reaction) => {
        sends++;
        assert.equal(text, '👍');
        assert.equal(taskId, sent.id);
        assert.deepEqual(reaction, {
          messageId: message.providerId,
          emoji: '👍',
        });
        return Promise.resolve({
          status: 'accepted',
          providerId: 'out-reaction-1',
        });
      };
      await service.dispatchOne();
      assert.equal(sends, 1);
      const projected = await call<
        Page<
          ChatMessage & {
            presentation: { hidden: boolean; reactions: { emoji: string }[] };
          }
        >
      >(a, 'GET', `/whatsapp/conversations/${c.id}/messages?pageSize=100`);
      assert.equal(
        projected.list.find((item) => item.id === sent.id)?.presentation.hidden,
        true,
      );
      assert.equal(
        projected.list.find((item) => item.id === message.id)?.presentation
          .reactions[0].emoji,
        '👍',
      );
    },
  );
  await check(
    'text outbox idempotency, provider accepted and out-of-order receipts',
    async () => {
      let sends = 0;
      provider.send = () => {
        sends++;
        return Promise.resolve({ status: 'accepted', providerId: 'out-1' });
      };
      const input = { clientRequestId: randomUUID(), text: 'Synthetic reply' };
      const sent = await call<ChatMessage>(
        a,
        'POST',
        `/whatsapp/conversations/${c.id}/messages`,
        input,
      );
      const again = await call<ChatMessage>(
        a,
        'POST',
        `/whatsapp/conversations/${c.id}/messages`,
        input,
      );
      assert.equal(sent.id, again.id);
      await service.dispatchOne();
      assert.equal(sends, 1);
      for (const status of ['Read', 'Sent', 'Delivered', 'Failed']) {
        await events.receive(
          payload('out-1', {
            From: '0000000000',
            To: 'ZZ.synthetic-contact',
            UserId: 'ZZ.synthetic-contact',
            Status: status,
            TaskId: sent.id,
          }),
          'status',
        );
        await events.processOne();
      }
      const [row] = await h.db.query<{ status: string }[]>(
        'SELECT status FROM whatsapp_messages WHERE id=$1',
        [sent.id],
      );
      assert.equal(row.status, 'read');
    },
  );
  await check(
    'quoted text binds same-conversation provider target and preserves it on retry',
    async () => {
      const path = `/whatsapp/conversations/${c.id}/messages`;
      const input = {
        clientRequestId: randomUUID(),
        text: '*Synthetic quoted reply*',
        replyToMessageId: message.id,
      };
      await call(b, 'POST', path, input, 404, 'NOT_FOUND');
      await call(other, 'POST', path, input, 403, 'AUTH_FORBIDDEN');
      await call(
        a,
        'POST',
        path,
        { ...input, contextMessageId: 'spoofed' },
        400,
      );
      await call(
        a,
        'POST',
        path,
        { ...input, replyToMessageId: randomUUID() },
        404,
        'NOT_FOUND',
      );
      const sent = await call<ChatMessage>(a, 'POST', path, input);
      assert.equal(sent.attachment?.replyToMessageId, message.id);
      assert.equal(sent.attachment?.contextMessageId, message.providerId);
      assert.deepEqual(sent.attachment?.replyTo, {
        id: message.id,
        text: message.text.slice(0, 280),
        kind: message.kind,
        direction: message.direction,
        source: message.source,
      });
      assert.equal(
        (await call<ChatMessage>(a, 'POST', path, input)).id,
        sent.id,
      );
      await call(
        a,
        'POST',
        path,
        { ...input, replyToMessageId: undefined },
        409,
        'CONFLICT',
      );
      await call(
        a,
        'POST',
        path,
        { ...input, replyToMessageId: randomUUID() },
        409,
        'CONFLICT',
      );
      await call(
        a,
        'POST',
        path,
        { ...input, clientRequestId: randomUUID(), replyToMessageId: sent.id },
        409,
        'CONFLICT',
      );
      const [reaction] = await h.db.query<{ id: string }[]>(
        "SELECT id FROM whatsapp_messages WHERE kind='reaction' LIMIT 1",
      );
      await call(
        a,
        'POST',
        path,
        {
          ...input,
          clientRequestId: randomUUID(),
          replyToMessageId: reaction.id,
        },
        409,
        'CONFLICT',
      );
      let sends = 0;
      provider.send = (
        _account,
        _recipient,
        text,
        _taskId,
        reaction,
        contextMessageId,
      ) => {
        sends++;
        assert.equal(text, input.text);
        assert.equal(reaction, undefined);
        assert.equal(contextMessageId, message.providerId);
        return Promise.resolve({
          status: 'failed',
          errorCode: 'PROVIDER_REJECTED',
        });
      };
      await service.dispatchOne();
      const retried = await call<ChatMessage>(
        a,
        'POST',
        `${path}/${sent.id}/retry`,
        { clientRequestId: randomUUID() },
      );
      assert.equal(retried.attachment?.contextMessageId, message.providerId);
      await service.dispatchOne();
      assert.equal(sends, 2);
      const saved = await call<Page<ChatMessage>>(
        a,
        'GET',
        `${path}?pageSize=100`,
      );
      assert.equal(
        saved.list.find((item) => item.id === retried.id)?.attachment
          ?.replyToMessageId,
        message.id,
      );
    },
  );
  await check(
    'mobile echoes have mobile origin and do not falsely attribute staff; API echo deduplicates',
    async () => {
      const echo = payload('mobile-1', {
        NoticeType: 'echos',
        From: '0000000000',
        To: 'ZZ.synthetic-contact',
        UserId: 'ZZ.synthetic-contact',
      });
      await events.receive(echo, 'inbound');
      await events.processOne();
      await events.receive({ ...echo, MessageId: 'out-1' }, 'inbound');
      await events.processOne();
      const [mobile] = await h.db.query<
        { source: string; actor_id: string | null }[]
      >(
        "SELECT source,actor_id FROM whatsapp_messages WHERE provider_id='mobile-1'",
      );
      assert.equal(mobile.source, 'mobile');
      assert.equal(mobile.actor_id, null);
      const [system] = await h.db.query<{ source: string }[]>(
        "SELECT source FROM whatsapp_messages WHERE provider_id='out-1'",
      );
      assert.equal(system.source, 'system');
    },
  );
  await check(
    'echo racing send response merges into the system message',
    async () => {
      provider.send = async () => {
        await events.receive(
          payload('race-out', {
            NoticeType: 'echos',
            From: '0000000000',
            To: 'ZZ.synthetic-contact',
            UserId: 'ZZ.synthetic-contact',
          }),
          'inbound',
        );
        await events.processOne();
        return { status: 'accepted', providerId: 'race-out' };
      };
      const sent = await call<ChatMessage>(
        a,
        'POST',
        `/whatsapp/conversations/${c.id}/messages`,
        { clientRequestId: randomUUID(), text: 'Synthetic race' },
      );
      await service.dispatchOne();
      const rows = await h.db.query<ChatMessage[]>(
        `SELECT id,source FROM whatsapp_messages WHERE provider_id='race-out'`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, sent.id);
      assert.equal(rows[0].source, 'system');
    },
  );
  await check('revoked sender is rejected before worker dispatch', async () => {
    const sent = await call<ChatMessage>(
      a,
      'POST',
      `/whatsapp/conversations/${c.id}/messages`,
      { clientRequestId: randomUUID(), text: 'Synthetic revoked' },
    );
    await h.db.query(`UPDATE users SET status='disabled' WHERE id=$1`, [a.id]);
    try {
      provider.send = () => {
        throw new Error('Must not send after revocation');
      };
      await service.dispatchOne();
      const [row] = await h.db.query<{ status: string }[]>(
        'SELECT status FROM whatsapp_messages WHERE id=$1',
        [sent.id],
      );
      assert.equal(row.status, 'failed');
    } finally {
      await h.db.query(`UPDATE users SET status='enabled' WHERE id=$1`, [a.id]);
    }
  });
  await check(
    'interrupted sends become unknown without automatic resend',
    async () => {
      const sent = await call<ChatMessage>(
        a,
        'POST',
        `/whatsapp/conversations/${c.id}/messages`,
        { clientRequestId: randomUUID(), text: 'Synthetic interruption' },
      );
      await h.db.query(
        `UPDATE whatsapp_messages SET status='sending',updated_at=now()-interval '3 minutes' WHERE id=$1`,
        [sent.id],
      );
      await service.dispatchOne();
      const [row] = await h.db.query<{ status: string; error_code: string }[]>(
        'SELECT status,error_code FROM whatsapp_messages WHERE id=$1',
        [sent.id],
      );
      assert.equal(row.status, 'unknown');
      assert.equal(row.error_code, 'SEND_INTERRUPTED');
      await events.receive(
        payload('interrupted-out', {
          From: '0000000000',
          To: 'ZZ.synthetic-contact',
          Status: 'Read',
          TaskId: sent.id,
        }),
        'status',
      );
      await events.processOne();
    },
  );
  await check(
    'timeout is unknown and cannot be blindly retried; explicit failure can retry',
    async () => {
      provider.send = () =>
        Promise.resolve({
          status: 'unknown',
          errorCode: 'PROVIDER_RESULT_UNKNOWN',
        });
      const sent = await call<ChatMessage>(
        a,
        'POST',
        `/whatsapp/conversations/${c.id}/messages`,
        { clientRequestId: randomUUID(), text: 'Synthetic timeout' },
      );
      await service.dispatchOne();
      await call(
        a,
        'POST',
        `/whatsapp/conversations/${c.id}/messages/${sent.id}/retry`,
        { clientRequestId: randomUUID() },
        409,
        'CONFLICT',
      );
      await events.receive(
        payload('out-timeout', {
          From: '0000000000',
          To: 'ZZ.synthetic-contact',
          Status: 'Failed',
          TaskId: sent.id,
        }),
        'status',
      );
      await events.processOne();
      provider.send = () =>
        Promise.resolve({
          status: 'accepted',
          providerId: 'retry-out',
        });
      await call(
        a,
        'POST',
        `/whatsapp/conversations/${c.id}/messages/${sent.id}/retry`,
        { clientRequestId: randomUUID() },
      );
      await service.dispatchOne();
    },
  );
  await check('24h restriction and worker rechecks queued sends', async () => {
    const queued = await call<ChatMessage>(
      a,
      'POST',
      `/whatsapp/conversations/${c.id}/messages`,
      { clientRequestId: randomUUID(), text: 'Synthetic expired' },
    );
    await h.db.query(
      "UPDATE whatsapp_contacts SET last_inbound_at=now()-interval '25 hours' WHERE id=$1",
      [c.contactId],
    );
    await service.dispatchOne();
    const [row] = await h.db.query<{ status: string }[]>(
      'SELECT status FROM whatsapp_messages WHERE id=$1',
      [queued.id],
    );
    assert.equal(row.status, 'failed');
    await call(
      a,
      'POST',
      `/whatsapp/conversations/${c.id}/messages`,
      { clientRequestId: randomUUID(), text: 'Synthetic' },
      409,
      'CONFLICT',
    );
    await events.receive(payload('in-2'), 'inbound');
    await events.processOne();
  });
  await check(
    'poison event isolation, wrong account, no status-before-message loss',
    async () => {
      await events.receive(
        [payload('bad-account', { To: '0000000001' }), payload('in-3')],
        'inbound',
      );
      await events.processOne();
      await events.processOne();
      const [bad] = await h.db.query<{ state: string; error_code: string }[]>(
        "SELECT state,error_code FROM whatsapp_events WHERE payload->>'MessageId'='bad-account'",
      );
      assert.equal(bad.state, 'failed');
      assert.equal(bad.error_code, 'ACCOUNT_MISMATCH');
      await events.receive(
        payload('mobile-late', {
          From: '0000000000',
          To: 'ZZ.synthetic-contact',
          Status: 'Read',
        }),
        'status',
      );
      await events.processOne();
      await events.receive(
        payload('mobile-late', {
          NoticeType: 'echos',
          From: '0000000000',
          To: 'ZZ.synthetic-contact',
          UserId: 'ZZ.synthetic-contact',
        }),
        'inbound',
      );
      await events.processOne();
      await events.processOne();
      const [late] = await h.db.query<{ status: string }[]>(
        "SELECT status FROM whatsapp_messages WHERE provider_id='mobile-late'",
      );
      assert.equal(late.status, 'read');
    },
  );
  await check(
    'inquiry owner transfer synchronizes conversation and invalidates former owner',
    async () => {
      const inquiry = await call<{ version: number }>(
        manager,
        'GET',
        `/website/inquiries/${inquiryId}`,
      );
      await call(manager, 'POST', `/website/inquiries/${inquiryId}/transfer`, {
        version: inquiry.version,
        ownerId: b.id,
        reason: 'Synthetic transfer',
      });
      await refresh();
      assert.equal(c.ownerId, b.id);
      await call(
        a,
        'GET',
        `/whatsapp/conversations/${c.id}`,
        undefined,
        404,
        'NOT_FOUND',
      );
    },
  );
  await check(
    'ledger association scope and owner constraints, immutable link and permanent assignment lock',
    async () => {
      const input = {
        websiteInquiryId: inquiryId,
        receivedDate: '2026-11-06',
        source: 'Synthetic',
        operatorId: b.id,
        itinerary: 'Synthetic title',
      };
      await call(a, 'POST', '/ledgers/direct', input, 400);
      const ledger = await call<{
        id: string;
        version: number;
        websiteInquiryId: string;
      }>(b, 'POST', '/ledgers/direct', input);
      ledgerId = ledger.id;
      assert.equal(ledger.websiteInquiryId, inquiryId);
      await refresh();
      assert(c.assignmentLockedAt);
      await call(
        manager,
        'POST',
        `/whatsapp/conversations/${c.id}/assign`,
        { version: c.version, ownerId: a.id, reason: 'Synthetic' },
        409,
        'CONFLICT',
      );
      const inquiry = await call<{ version: number }>(
        manager,
        'GET',
        `/website/inquiries/${inquiryId}`,
      );
      await call(
        manager,
        'POST',
        `/website/inquiries/${inquiryId}/transfer`,
        { version: inquiry.version, ownerId: a.id, reason: 'Synthetic' },
        409,
        'CONFLICT',
      );
      // Real delete endpoint: permanent lock survives loss of the current ledger row.
      await call(
        b,
        'DELETE',
        `/ledgers/direct/${ledger.id}?version=${ledger.version}`,
        undefined,
        204,
      );
      await refresh();
      assert(c.assignmentLockedAt);
      await call(
        manager,
        'POST',
        `/whatsapp/conversations/${c.id}/assign`,
        { version: c.version, ownerId: a.id, reason: 'Synthetic' },
        409,
        'CONFLICT',
      );
      const replacement = await call<{ id: string }>(
        b,
        'POST',
        '/ledgers/direct',
        input,
      );
      ledgerId = replacement.id;
    },
  );
  await check(
    'closed conversation reopens on inbound without new inquiry',
    async () => {
      await refresh();
      await call(b, 'POST', `/whatsapp/conversations/${c.id}/state`, {
        version: c.version,
        state: 'closed',
      });
      await events.receive(payload('in-reopen'), 'inbound');
      await events.processOne();
      await refresh();
      assert.equal(c.state, 'open');
      assert.equal(c.inquiryId, inquiryId);
    },
  );
  await check(
    'new consultation requires formed tour, then old read-only and new supervisor-only',
    async () => {
      await call(
        b,
        'POST',
        `/whatsapp/conversations/${c.id}/new-consultation`,
        { version: c.version },
        409,
        'CONFLICT',
      );
      const [country] = await h.db.query<{ id: string }[]>(
        `SELECT id FROM system_business_dictionary_items WHERE code='UNKNOWN' LIMIT 1`,
      );
      const tour = await call<{ id: string }>(
        b,
        'POST',
        `/ledgers/direct/${ledgerId}/convert`,
        {
          version: 1,
          tour: {
            countryItemId: country.id,
            days: 1,
            startDate: '2026-12-01',
            adults: 1,
            children: 0,
            leaders: 0,
            shopping: false,
            itinerarySummary: 'Synthetic title',
            scheduleMode: 'manual',
            pickupAt: '2026-12-01 08:00',
            dropAt: '2026-12-01 18:00',
            guideServices: [],
          },
        },
      );
      assert(tour);
      await refresh();
      const oldId = c.id;
      const created = await call<{ id: string; canView: boolean }>(
        b,
        'POST',
        `/whatsapp/conversations/${oldId}/new-consultation`,
        { version: c.version },
      );
      assert.equal(created.canView, false);
      await call(
        b,
        'GET',
        `/whatsapp/conversations/${created.id}`,
        undefined,
        404,
        'NOT_FOUND',
      );
      await call(
        b,
        'POST',
        `/whatsapp/conversations/${oldId}/messages`,
        { clientRequestId: randomUUID(), text: 'Synthetic' },
        409,
        'CONFLICT',
      );
      await events.receive(payload('in-new'), 'inbound');
      await events.processOne();
      const newMessages = await call<Page<ChatMessage>>(
        manager,
        'GET',
        `/whatsapp/conversations/${created.id}/messages`,
      );
      assert.equal(newMessages.total, 1);
      await call(
        manager,
        'POST',
        `/whatsapp/conversations/${created.id}/messages`,
        {
          clientRequestId: randomUUID(),
          text: 'Synthetic cross-consultation quote',
          replyToMessageId: message.id,
        },
        404,
        'NOT_FOUND',
      );
      const detail = await call<{
        hasFormedTours: boolean;
        tours: { title: string }[];
      }>(manager, 'GET', `/whatsapp/conversations/${created.id}`);
      assert(detail.hasFormedTours);
      assert.equal(detail.tours[0].title, 'Synthetic title');
      await events.receive(
        payload('in-delayed', {
          Timestamp: message.occurredAt
            ? new Date(message.occurredAt).getTime()
            : Date.now() - 60000,
        }),
        'inbound',
      );
      await events.processOne();
      const [delayed] = await h.db.query<{ conversation_id: string }[]>(
        "SELECT conversation_id FROM whatsapp_messages WHERE provider_id='in-delayed'",
      );
      assert.equal(delayed.conversation_id, oldId);
    },
  );
  await check(
    'HTTP ingress authorization, source linking and metadata-only failure diagnostics',
    async () => {
      await call(
        undefined,
        'POST',
        '/whatsapp/ingress/inbound',
        payload('forged'),
        403,
        'AUTH_FORBIDDEN',
      );
      const relay = { token: config.WHATSAPP_CHAT_HTTP_TOKEN } as Actor;
      await h.call(
        relay,
        'POST',
        '/whatsapp/ingress/inbound',
        payload('via-http'),
        200,
        0,
      );
      await events.processOne();
      const integration = await call<Record<string, unknown>>(
        root,
        'GET',
        '/whatsapp/integration',
      );
      assert(
        !JSON.stringify(integration).includes(config.WHATSAPP_CHAT_HTTP_TOKEN),
      );
      const errors = await call<Page<Record<string, unknown>>>(
        root,
        'GET',
        '/whatsapp/integration/failed-events',
      );
      assert(!JSON.stringify(errors).includes('Synthetic inquiry'));
    },
  );
  await check(
    'down migration refuses destructive rollback with messages',
    async () => {
      await assert.rejects(undoWhatsappMigration(), /Refusing rollback/);
      assert.equal((await page()).total, 1);
    },
  );
  console.log(
    `PASS ${checks} WhatsApp integration groups; ${h.requests} HTTP requests. No cloud sends.`,
  );
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => h.close());
