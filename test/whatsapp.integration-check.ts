import { AddFeishuNotificationManagement1796256000000 } from '../src/migrations/1796256000000-AddFeishuNotificationManagement';
/** Isolated local PostgreSQL only; mock sends, no cloud credentials or real customer data. */
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { MessagePresentation } from '../src/whatsapp/whatsapp.presentation';
import { randomUUID } from 'node:crypto';
import { CreateWhatsappWorkbench1795651200000 } from '../src/migrations/1795651200000-CreateWhatsappWorkbench';
import { AddWhatsappQuickReplies1795824000000 } from '../src/migrations/1795824000000-AddWhatsappQuickReplies';
import { AddWhatsappCustomerNotes1795910400000 } from '../src/migrations/1795910400000-AddWhatsappCustomerNotes';
import { AddWhatsappEventMessageIndex1795996800000 } from '../src/migrations/1795996800000-AddWhatsappEventMessageIndex';
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
    await new AddFeishuNotificationManagement1796256000000().down(
      manager.queryRunner,
    );
    await new AddWhatsappEventMessageIndex1795996800000().down(
      manager.queryRunner,
    );
    await new AddWhatsappCustomerNotes1795910400000().down(manager.queryRunner);
    await new AddWhatsappQuickReplies1795824000000().down(manager.queryRunner);
    await new CreateWhatsappWorkbench1795651200000().down(manager.queryRunner);
    await manager.query(
      'DELETE FROM migrations WHERE name IN ($1,$2,$3,$4,$5)',
      [
        'CreateWhatsappWorkbench1795651200000',
        'AddWhatsappQuickReplies1795824000000',
        'AddWhatsappCustomerNotes1795910400000',
        'AddWhatsappEventMessageIndex1795996800000',
        'AddFeishuNotificationManagement1796256000000',
      ],
    );
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
  provider.reactionTarget = () => Promise.resolve('wamid.synthetic-original');
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
      assert.equal((await h.db.runMigrations()).length, 5);
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
      root = await h.actor('headquarters', 'ROOT', null, undefined, 'mango');
      assert.equal(
        (await call<Page>(root, 'GET', '/whatsapp/conversations')).total,
        1,
      );
      await call(root, 'GET', '/whatsapp/integration');
    },
  );
  await check(
    'summary is scoped, read-only, excludes imported and archived messages',
    async () => {
      const summary = (actor: Actor) =>
        call<{ unreadCount: number; unassignedCount: number | null }>(
          actor,
          'GET',
          '/whatsapp/summary',
        );
      const initial = await summary(manager);
      assert(initial.unreadCount > 0);
      assert.equal(initial.unassignedCount, 1);
      assert.deepEqual(await summary(a), {
        unreadCount: 0,
        unassignedCount: null,
      });
      assert.deepEqual(await summary(root), initial);
      await call(
        other,
        'GET',
        '/whatsapp/summary',
        undefined,
        403,
        'AUTH_FORBIDDEN',
      );
      const ordinaryRoot = await h.actor('headquarters', 'ROOT');
      await call(
        ordinaryRoot,
        'GET',
        '/whatsapp/summary',
        undefined,
        403,
        'AUTH_FORBIDDEN',
      );
      assert.deepEqual(await summary(manager), initial);
      const [{ count: reads }] = await h.db.query<{ count: string }[]>(
        'SELECT count(*) FROM whatsapp_reads',
      );
      assert.equal(reads, '0');
      await h.db.query(
        "UPDATE whatsapp_conversations SET state='closed' WHERE id=$1",
        [c.id],
      );
      assert.deepEqual(await summary(manager), {
        unreadCount: initial.unreadCount,
        unassignedCount: initial.unassignedCount - 1,
      });
      await h.db.query(
        "UPDATE whatsapp_conversations SET state='open' WHERE id=$1",
        [c.id],
      );
      assert.deepEqual(await summary(manager), initial);
      const [{ id: targetId }] = await h.db.query<{ id: string }[]>(
        "SELECT id FROM whatsapp_messages WHERE conversation_id=$1 AND direction='inbound' LIMIT 1",
        [c.id],
      );
      const eventId = randomUUID();
      await h.db.query(
        "INSERT INTO whatsapp_events(id,account_id,event_key,kind,payload,state,message_id) VALUES($1::uuid,$2,$1::text,'history_import','{}','done',$3)",
        [eventId, c.accountId, targetId],
      );
      assert.equal(
        (await summary(manager)).unreadCount,
        initial.unreadCount - 1,
      );
      await h.db.query('DELETE FROM whatsapp_events WHERE id=$1', [eventId]);
      await h.db.query(
        "UPDATE whatsapp_conversations SET state='archived',archived_at=now() WHERE id=$1",
        [c.id],
      );
      assert.deepEqual(await summary(manager), {
        unreadCount: 0,
        unassignedCount: 0,
      });
      await h.db.query(
        "UPDATE whatsapp_conversations SET state='open',archived_at=NULL WHERE id=$1",
        [c.id],
      );
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
    'read position is explicit, shared across viewers and never moves backwards',
    async () => {
      const messages = await call<Page<ChatMessage>>(
        a,
        'GET',
        `/whatsapp/conversations/${c.id}/messages`,
      );
      message = messages.list[0];
      const assignedSummary = await call<{
        unreadCount: number;
        unassignedCount: number | null;
      }>(a, 'GET', '/whatsapp/summary');
      assert(assignedSummary.unreadCount > 0);
      assert.equal(assignedSummary.unassignedCount, null);
      assert.equal(
        (
          await call<{ unassignedCount: number }>(
            manager,
            'GET',
            '/whatsapp/summary',
          )
        ).unassignedCount,
        0,
      );
      assert.equal(
        (await call<Page>(a, 'GET', '/whatsapp/conversations?unread=true'))
          .total,
        1,
      );
      await call(manager, 'POST', `/whatsapp/conversations/${c.id}/read`, {
        lastSeq: message.seq,
      });
      const unreadCount = async (actor: Actor) =>
        (await call<{ unreadCount: number }>(actor, 'GET', '/whatsapp/summary'))
          .unreadCount;
      for (const actor of [manager, a, root]) {
        assert.equal(await unreadCount(actor), 0);
        const unread = await call<Page<Conversation>>(
          actor,
          'GET',
          '/whatsapp/conversations?unread=true',
        );
        assert.equal(unread.total, 0);
        const read = await call<Page<Conversation & { unreadCount: number }>>(
          actor,
          'GET',
          '/whatsapp/conversations?unread=false',
        );
        assert.equal(read.list.find((row) => row.id === c.id)?.unreadCount, 0);
      }
      // Existing reader records are sufficient: no backfill and no reset for a newly logged-in colleague.
      assert.deepEqual(
        await call(a, 'POST', `/whatsapp/conversations/${c.id}/read`, {
          lastSeq: '0',
        }),
        { lastSeq: message.seq },
      );
      await events.receive(payload('shared-read-new-message'), 'inbound');
      await events.processOne();
      for (const actor of [manager, a, root])
        assert.equal(await unreadCount(actor), 1);
      await call(
        b,
        'POST',
        `/whatsapp/conversations/${c.id}/read`,
        {
          lastSeq: message.seq,
        },
        404,
        'NOT_FOUND',
      );
      assert.equal(await unreadCount(manager), 1);
      const latest = (
        await call<Page<ChatMessage>>(
          a,
          'GET',
          `/whatsapp/conversations/${c.id}/messages`,
        )
      ).list[0];
      await call(a, 'POST', `/whatsapp/conversations/${c.id}/read`, {
        lastSeq: latest.seq,
      });
      assert.deepEqual(
        await call(manager, 'POST', `/whatsapp/conversations/${c.id}/read`, {
          lastSeq: message.seq,
        }),
        { lastSeq: latest.seq },
      );
      for (const actor of [manager, a, root])
        assert.equal(await unreadCount(actor), 0);
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
    'reaction lookup releases the row lock and rechecks scope, state and window',
    async () => {
      const path = `/whatsapp/conversations/${c.id}/messages/${message.id}/reactions`;
      const originalLookup = provider.reactionTarget.bind(provider);
      const before = await h.db.query<{ id: string }[]>(
        'SELECT id FROM whatsapp_messages WHERE conversation_id=$1',
        [c.id],
      );
      for (const change of ['owner', 'state', 'window']) {
        provider.reactionTarget = async () => {
          await h.db.transaction(async (tx) => {
            await tx.query("SET LOCAL lock_timeout='500ms'");
            await tx.query(
              'SELECT id FROM whatsapp_conversations WHERE id=$1 FOR UPDATE',
              [c.id],
            );
            if (change === 'owner')
              await tx.query(
                'UPDATE whatsapp_conversations SET owner_id=$2 WHERE id=$1',
                [c.id, b.id],
              );
            if (change === 'state')
              await tx.query(
                "UPDATE whatsapp_conversations SET state='closed' WHERE id=$1",
                [c.id],
              );
            if (change === 'window')
              await tx.query(
                "UPDATE whatsapp_contacts SET last_inbound_at=now()-interval '25 hours' WHERE id=$1",
                [c.contactId],
              );
          });
          return 'wamid.synthetic-original';
        };
        await call(
          a,
          'POST',
          path,
          { clientRequestId: randomUUID(), emoji: '👍' },
          change === 'owner' ? 404 : 409,
          change === 'owner' ? 'NOT_FOUND' : 'CONFLICT',
        );
        await h.db.query(
          "UPDATE whatsapp_conversations SET owner_id=$2,state='open' WHERE id=$1",
          [c.id, a.id],
        );
        await h.db.query(
          'UPDATE whatsapp_contacts SET last_inbound_at=now() WHERE id=$1',
          [c.contactId],
        );
      }
      provider.reactionTarget = () => Promise.resolve(null);
      await call(
        a,
        'POST',
        path,
        { clientRequestId: randomUUID(), emoji: '👍' },
        409,
        'CONFLICT',
      );
      provider.reactionTarget = originalLookup;
      assert.equal(
        (
          await h.db.query<{ id: string }[]>(
            'SELECT id FROM whatsapp_messages WHERE conversation_id=$1',
            [c.id],
          )
        ).length,
        before.length,
      );
      assert.deepEqual(await call(a, 'GET', '/whatsapp/summary'), {
        unreadCount: 0,
        unassignedCount: null,
      });
      assert.deepEqual(await call(b, 'GET', '/whatsapp/summary'), {
        unreadCount: 0,
        unassignedCount: null,
      });
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
      assert.equal(sent.attachment?.messageId, 'wamid.synthetic-original');
      provider.reactionTarget = () => {
        throw new Error('Replay must not query provider');
      };
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
          messageId: 'wamid.synthetic-original',
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
    'quick reply maintenance is scoped, versioned and excludes disabled content from composer',
    async () => {
      const path = '/whatsapp/quick-replies';
      const input = {
        stage: 'Synthetic stage',
        scenario: 'Synthetic scenario',
        content: '*Synthetic reply*',
        enabled: true,
        sortOrder: 2,
      };
      await call(a, 'POST', path, input, 403, 'AUTH_FORBIDDEN');
      await call(other, 'GET', path, undefined, 403, 'AUTH_FORBIDDEN');
      await call(a, 'GET', `${path}/manage`, undefined, 403, 'AUTH_FORBIDDEN');
      await call(
        manager,
        'POST',
        path,
        { ...input, content: 'x'.repeat(4097) },
        400,
      );
      const row = await call<{ id: string; version: number }>(
        manager,
        'POST',
        path,
        input,
      );
      await call(
        manager,
        'POST',
        path,
        input,
        409,
        'DATABASE_CONSTRAINT_VIOLATION',
      );
      assert.equal(
        (await call<Page>(a, 'GET', `${path}?stage=Synthetic%20stage`)).total,
        1,
      );
      assert.deepEqual(
        (await call<{ stages: string[] }>(a, 'GET', `${path}/options`)).stages,
        ['Synthetic stage'],
      );
      assert.deepEqual(
        (
          await call<{ scenarios: string[] }>(
            a,
            'GET',
            `${path}/options?stage=Synthetic%20stage`,
          )
        ).scenarios,
        ['Synthetic scenario'],
      );
      await call(
        a,
        'PUT',
        `${path}/${row.id}`,
        { ...input, version: row.version },
        403,
        'AUTH_FORBIDDEN',
      );
      await call(manager, 'PUT', `${path}/${row.id}`, {
        ...input,
        enabled: false,
        version: row.version,
      });
      await call(
        manager,
        'PUT',
        `${path}/${row.id}`,
        { ...input, version: row.version },
        409,
        'CONFLICT',
      );
      const current = await call<{ version: number; enabled: boolean }>(
        manager,
        'GET',
        `${path}/${row.id}`,
      );
      assert.equal(current.version, row.version + 1);
      assert.equal(current.enabled, false);
      await call(
        a,
        'GET',
        `${path}/${row.id}`,
        undefined,
        403,
        'AUTH_FORBIDDEN',
      );
      await call(
        other,
        'GET',
        `${path}/${row.id}`,
        undefined,
        403,
        'AUTH_FORBIDDEN',
      );
      await call(
        manager,
        'GET',
        `${path}/${randomUUID()}`,
        undefined,
        404,
        'NOT_FOUND',
      );
      assert.equal((await call<Page>(a, 'GET', path)).total, 0);
      assert.equal(
        (await call<Page>(manager, 'GET', `${path}/manage`)).total,
        1,
      );
      assert.deepEqual(
        (await call<{ stages: string[] }>(a, 'GET', `${path}/options`)).stages,
        [],
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
  await check(
    'supervisor confirms a stale unknown send as failed, audited, then it can be retried',
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
        { clientRequestId: randomUUID(), text: 'Synthetic stale unknown' },
      );
      await service.dispatchOne();
      const path = `/whatsapp/conversations/${c.id}/messages/${sent.id}/confirm-failed`;
      await call(a, 'POST', path, undefined, 403, 'AUTH_FORBIDDEN');
      await call(manager, 'POST', path, undefined, 409, 'CONFLICT');
      await h.db.query(
        "UPDATE whatsapp_messages SET updated_at=now()-interval '11 minutes' WHERE id=$1",
        [sent.id],
      );
      const confirmed = await call<{ status: string; errorCode: string }>(
        manager,
        'POST',
        path,
        undefined,
        200,
      );
      assert.equal(confirmed.status, 'failed');
      assert.equal(confirmed.errorCode, 'MANUALLY_CONFIRMED_FAILED');
      await call(manager, 'POST', path, undefined, 409, 'CONFLICT');
      const [audit] = await h.db.query<{ total: number }[]>(
        "SELECT count(*)::int total FROM whatsapp_actions WHERE conversation_id=$1 AND action='message_confirmed_failed' AND details->>'messageId'=$2",
        [c.id, sent.id],
      );
      assert.equal(audit.total, 1);
      provider.send = () =>
        Promise.resolve({
          status: 'accepted',
          providerId: 'confirmed-retry-out',
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
    'reply capability follows send switch and test allowlist without widening send access',
    async () => {
      const current = (await page()).list[0];
      const cfg = h.get(ConfigService);
      const detail = () =>
        call<{
          capabilities: { canReply: boolean };
          sendBlockedReason: string | null;
        }>(manager, 'GET', `/whatsapp/conversations/${current.id}`);
      assert.equal((await detail()).capabilities.canReply, true);
      cfg.set('WHATSAPP_CHAT_SEND_ENABLED', 'false');
      assert.deepEqual((await detail()).sendBlockedReason, 'send_disabled');
      assert.equal((await detail()).capabilities.canReply, false);
      await call(
        manager,
        'POST',
        `/whatsapp/conversations/${current.id}/messages`,
        { clientRequestId: randomUUID(), text: 'blocked' },
        409,
        'CONFLICT',
      );
      cfg.set('WHATSAPP_CHAT_SEND_ENABLED', 'true');
      cfg.set('WHATSAPP_CHAT_TEST_RECIPIENTS', '');
      assert.equal((await detail()).sendBlockedReason, 'test_recipient');
      assert.equal((await detail()).capabilities.canReply, false);
      await call(
        manager,
        'POST',
        `/whatsapp/conversations/${current.id}/messages`,
        { clientRequestId: randomUUID(), text: 'blocked' },
        403,
        'AUTH_FORBIDDEN',
      );
      cfg.set(
        'WHATSAPP_CHAT_TEST_RECIPIENTS',
        config.WHATSAPP_CHAT_TEST_RECIPIENTS,
      );
      assert.equal((await detail()).capabilities.canReply, true);
      assert.equal((await detail()).sendBlockedReason, null);
    },
  );
  await check(
    'page-limited projection resolves off-page originals, history aliases, latest reactions and edits',
    async () => {
      const current = (await page()).list[0];
      const insert = async (
        kind: string,
        attachment: Record<string, unknown> | null,
        providerId: string | null = null,
      ) => {
        const [row] = await h.db.query<{ id: string; seq: string }[]>(
          `INSERT INTO whatsapp_messages(account_id,conversation_id,provider_id,direction,source,kind,text,status,occurred_at,attachment)
        VALUES($1,$2,$3,'inbound','customer',$4,'original','received',now(),$5::jsonb) RETURNING id,seq::text`,
          [
            current.accountId,
            current.id,
            providerId,
            kind,
            attachment ? JSON.stringify(attachment) : null,
          ],
        );
        return row;
      };
      const original = await insert('text', null, 'page-projection-original');
      await h.db.query(
        `INSERT INTO whatsapp_events(account_id,event_key,payload,kind,state,message_id) VALUES($1,'page-history',$2::jsonb,'history_import','done',$3)`,
        [
          current.accountId,
          JSON.stringify({
            record: { UniqueMessageId: 'wamid.page-original' },
          }),
          original.id,
        ],
      );
      await h.db.query(
        `INSERT INTO whatsapp_messages(account_id,conversation_id,direction,source,kind,text,status,occurred_at)
      SELECT $1,$2,'inbound','customer','text','unrelated','received',now() FROM generate_series(1,120)`,
        [current.accountId, current.id],
      );
      await insert('reaction', {
        messageCode: 'page-projection-original',
        emoji: '👍',
      });
      const reaction = await insert('reaction', {
        message_id: 'wamid.page-original',
        emoji: '❤️',
      });
      const edit = await insert('text', {
        type: 'edit',
        edit: {
          original_message_id: 'wamid.page-original',
          message: { text: { body: 'edited across pages' } },
        },
      });
      const unlinked = await insert('reaction', {
        messageId: 'missing-original',
        emoji: '😮',
      });
      const one = async (seq: string) =>
        (
          await call<Page<ChatMessage & { presentation: MessagePresentation }>>(
            manager,
            'GET',
            `/whatsapp/conversations/${current.id}/messages?pageSize=1&beforeSeq=${BigInt(seq) + 1n}`,
          )
        ).list[0];
      const bubble = await one(original.seq);
      assert.equal(bubble.id, original.id);
      assert.equal(bubble.presentation.text, 'edited across pages');
      assert.deepEqual(
        bubble.presentation.reactions.map((r) => r.emoji),
        ['❤️'],
      );
      assert.equal(
        (await one(reaction.seq)).presentation.targetMessageId,
        original.id,
      );
      assert.equal((await one(reaction.seq)).presentation.hidden, true);
      assert.equal(
        (await one(edit.seq)).presentation.targetMessageId,
        original.id,
      );
      assert.equal((await one(unlinked.seq)).presentation.hidden, false);
      assert.equal(
        (await one(unlinked.seq)).presentation.targetMessageId,
        null,
      );
    },
  );
  await check(
    'outbound diagnostics count system backlog and oldest unfinished record only',
    async () => {
      type Status = {
        outbound: {
          queued: number;
          sending: number;
          unknown: number;
          failed: number;
          oldestPendingAt: string | null;
        };
        worker: {
          scope: string;
          events: { state: string };
          outbound: { state: string };
        };
      };
      const current = (await page()).list[0];
      const before = await call<Status>(root, 'GET', '/whatsapp/integration');
      const oldest = '2000-01-01T00:00:00.000Z';
      for (const status of [
        'queued',
        'sending',
        'unknown',
        'failed',
        'accepted',
      ]) {
        await h.db.query(
          `INSERT INTO whatsapp_messages(account_id,conversation_id,direction,source,kind,text,status,occurred_at,created_at)
        VALUES($1,$2,'outbound','system','text','synthetic',$3,now(),$4::timestamptz)`,
          [current.accountId, current.id, status, oldest],
        );
      }
      await h.db.query(
        `INSERT INTO whatsapp_messages(account_id,conversation_id,direction,source,kind,text,status,occurred_at)
      VALUES($1,$2,'outbound','mobile','text','synthetic','failed',now())`,
        [current.accountId, current.id],
      );
      const after = await call<Status>(root, 'GET', '/whatsapp/integration');
      for (const status of ['queued', 'sending', 'unknown', 'failed'] as const)
        assert.equal(after.outbound[status], before.outbound[status] + 1);
      assert.equal(after.outbound.oldestPendingAt, oldest);
      assert.equal(after.worker.scope, 'current_process');
      assert.equal(after.worker.events.state, 'disabled');
      assert.equal(after.worker.outbound.state, 'disabled');
      await call(
        manager,
        'GET',
        '/whatsapp/integration',
        undefined,
        403,
        'AUTH_FORBIDDEN',
      );
    },
  );
  await check(
    'down migration refuses destructive rollback with messages',
    async () => {
      await assert.rejects(
        undoWhatsappMigration(),
        /Refusing rollback|Notification settings and delivery audit must be retained/,
      );
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
