/** Disposable local PostgreSQL, synthetic customers and mock provider; never reads .env. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Actor, IsolationHarness, Page } from './business-isolation.harness';
import { WhatsappEvents } from '../src/whatsapp/whatsapp.events';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { WhatsappProvider } from '../src/whatsapp/whatsapp.provider';
import { WhatsappStreamService } from '../src/whatsapp/whatsapp-stream.service';
import { notifyWhatsappChange } from '../src/whatsapp/whatsapp-changes';
import { ChatMessage, Conversation } from '../src/whatsapp/whatsapp.types';
const h = new IsolationHarness({
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
});
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean, label: string, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!predicate() && Date.now() < end) await pause(20);
  assert(predicate(), label);
}
interface Stream {
  text: string;
  ended: boolean;
  controller: AbortController;
  done: Promise<void>;
}
let base: string;
const streams: Stream[] = [];
async function stream(actor: Actor): Promise<Stream> {
  const controller = new AbortController();
  const response = await fetch(`${base}/whatsapp/stream`, {
    headers: { Authorization: `Bearer ${actor.token}` },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /^text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  const state: Stream = {
    text: '',
    ended: false,
    controller,
    done: Promise.resolve(),
  };
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  state.done = (async () => {
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        state.text += decoder.decode(result.value, { stream: true });
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      state.ended = true;
    }
  })();
  streams.push(state);
  await until(
    () => state.text.includes('event: ready'),
    'ready arrives immediately',
  );
  assert(!state.text.includes('SUCCESS'));
  return state;
}
let checks = 0;
function passed(name: string) {
  console.log(`PASS ${++checks}: ${name}`);
}
async function main() {
  await h.start();
  const server = h.get(HttpAdapterHost).httpAdapter.getHttpServer() as Server;
  const address = server.address();
  assert(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api`;
  const manager = await h.actor('website', 'BUSINESS_MANAGER');
  const a = await h.actor('website'),
    b = await h.actor('website'),
    outsider = await h.actor('linxi');
  for (const [actor, status] of [
    [undefined, 401],
    [outsider, 403],
  ] as const) {
    const response = await fetch(`${base}/whatsapp/stream`, {
      headers: actor ? { Authorization: `Bearer ${actor.token}` } : {},
    });
    assert.equal(response.status, status);
    assert.match(response.headers.get('content-type')!, /json/);
    await response.arrayBuffer();
  }
  const me = await h.call<Record<string, unknown>>(manager, 'GET', '/auth/me');
  assert(!('accessExpiresAt' in me));
  passed('401/403 JSON; auth/me unchanged');
  const supervisor = await stream(manager),
    first = await stream(a),
    second = await stream(b);
  await pause(500);
  for (const s of streams) s.text = '';
  const events = h.get(WhatsappEvents),
    service = h.get(WhatsappService);
  const payload = (id: string) => ({
    MessageId: id,
    CustSpaceId: 'test-space',
    WabaId: 'test-waba',
    FromUserId: 'ZZ.synthetic-contact',
    From: 'ZZ.synthetic-contact',
    To: '0000000000',
    Name: 'Synthetic',
    Type: 'TEXT',
    Message: 'Synthetic',
    Timestamp: Date.now(),
  });
  await events.receive(payload('sse-inbound'), 'inbound');
  await events.processOne();
  let c = (
    await h.call<Page<Conversation>>(manager, 'GET', '/whatsapp/conversations')
  ).list[0];
  assert(c);
  await until(
    () => supervisor.text.includes(c.id),
    'supervisor sees unassigned event',
  );
  assert(!first.text.includes(c.id));
  assert(!second.text.includes(c.id));
  assert(supervisor.text.includes('event: summary.changed'));
  passed('real inbound commit and scope filtering');
  const refresh = async () => {
    c = await h.call<Conversation>(
      manager,
      'GET',
      `/whatsapp/conversations/${c.id}`,
    );
  };
  await h.call(manager, 'POST', `/whatsapp/conversations/${c.id}/assign`, {
    version: c.version,
    ownerId: a.id,
  });
  await until(() => first.text.includes(c.id), 'new owner sees conversation');
  assert(second.text.includes('event: access.changed'));
  assert(!second.text.includes(c.id));
  await refresh();
  for (const s of streams) s.text = '';
  await h.call(manager, 'POST', `/whatsapp/conversations/${c.id}/assign`, {
    version: c.version,
    ownerId: b.id,
  });
  await until(
    () =>
      first.text.includes('event: access.changed') &&
      second.text.includes(c.id),
    'both owners invalidated',
  );
  assert(!first.text.includes(c.id));
  passed('old/new owner access invalidation without ID leak');
  for (const s of streams) s.text = '';
  const runner = h.db.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  await notifyWhatsappChange(runner.manager, {
    conversationId: c.id,
    reason: 'notes',
  });
  await pause(550);
  assert(!supervisor.text.includes(c.id));
  await runner.rollbackTransaction();
  await pause(550);
  assert(!supervisor.text.includes(c.id));
  await runner.startTransaction();
  for (const reason of ['message', 'status', 'read', 'message'] as const)
    await notifyWhatsappChange(runner.manager, {
      conversationId: c.id,
      reason,
    });
  await runner.commitTransaction();
  await runner.release();
  await until(
    () => supervisor.text.includes(c.id),
    'committed notify delivered',
  );
  assert.equal(
    supervisor.text.match(/event: conversation.changed/g)?.length,
    1,
  );
  assert(supervisor.text.includes('"reasons":["message","read","status"]'));
  assert.equal(supervisor.text.match(/event: summary.changed/g)?.length, 1);
  passed('real commit/rollback, reasons union and summary coalescing');
  await refresh();
  supervisor.text = '';
  await h.call(manager, 'POST', `/whatsapp/conversations/${c.id}/state`, {
    version: c.version,
    state: 'closed',
  });
  await events.receive(payload('sse-reopen'), 'inbound');
  await events.processOne();
  await until(
    () =>
      supervisor.text.includes('"state"') &&
      supervisor.text.includes('"message"'),
    'reopen reasons',
  );
  const messages = await h.call<Page<ChatMessage>>(
    manager,
    'GET',
    `/whatsapp/conversations/${c.id}/messages`,
  );
  await pause(500);
  supervisor.text = '';
  second.text = '';
  await h.call(b, 'POST', `/whatsapp/conversations/${c.id}/read`, {
    lastSeq: messages.list[0].seq,
  });
  await until(
    () => supervisor.text.includes('"read"') && second.text.includes('"read"'),
    'shared read reaches all viewers',
  );
  await pause(500);
  supervisor.text = '';
  await h.call(b, 'POST', `/whatsapp/conversations/${c.id}/read`, {
    lastSeq: messages.list[0].seq,
  });
  await pause(550);
  assert.equal(supervisor.text, '');
  passed('reopen, shared read and unchanged-read suppression');
  h.get(WhatsappProvider).send = () =>
    Promise.resolve({
      status: 'accepted',
      providerId: 'sse-outbound-provider',
    });
  supervisor.text = '';
  const outbound = await h.call<ChatMessage>(
    b,
    'POST',
    `/whatsapp/conversations/${c.id}/messages`,
    { clientRequestId: randomUUID(), text: 'Synthetic outbound' },
    201,
  );
  await until(() => supervisor.text.includes('"message"'), 'enqueue notifies');
  supervisor.text = '';
  await service.dispatchOne();
  await until(() => supervisor.text.includes('"status"'), 'worker notifies');
  const [accepted] = await h.db.query<{ status: string }[]>(
    'SELECT status FROM whatsapp_messages WHERE id=$1',
    [outbound.id],
  );
  assert.equal(accepted.status, 'accepted');
  passed('outbound enqueue and worker accepted with mock provider');
  supervisor.text = '';
  await h.db.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name='whatsapp-sse-listener'",
  );
  await until(
    () => supervisor.ended && supervisor.text.includes('event: resync'),
    'listener loss resync/close',
  );
  let recovered = false;
  for (let i = 0; i < 30; i++) {
    await pause(100);
    const response = await fetch(`${base}/whatsapp/stream`, {
      headers: { Authorization: `Bearer ${manager.token}` },
    });
    if (response.status === 200) {
      await response.body?.cancel();
      recovered = true;
      break;
    }
    assert.equal(response.status, 503);
    await response.arrayBuffer();
  }
  assert(recovered);
  const after = await stream(manager);
  await h.db.transaction((em) => notifyWhatsappChange(em, { type: 'resync' }));
  await until(() => after.text.includes('event: resync'), 'maintenance resync');
  passed('real LISTEN termination/reconnect and maintenance resync');
  const revoked = await stream(b);
  await h.call(b, 'POST', '/auth/logout', undefined, 204);
  await h.db.transaction((em) =>
    notifyWhatsappChange(em, { conversationId: c.id, reason: 'message' }),
  );
  await until(() => revoked.ended, 'logout closes before event delivery');
  assert(revoked.text.includes('event: access.changed'));
  assert(!revoked.text.includes(c.id));
  passed('real session revocation, no queued ID leak');
  const jwt = new JwtService(),
    decoded = jwt.decode<Record<string, unknown>>(manager.token);
  delete decoded.exp;
  delete decoded.iat;
  const short = await stream({
    ...manager,
    token: jwt.sign(decoded, {
      secret: 'isolation-access-secret-never-used-outside-tests',
      expiresIn: 11,
    }),
  });
  await until(() => short.ended, 'expiry closes', 3000);
  assert(short.text.includes('event: auth.expired'));
  await h.get(WhatsappStreamService).onModuleDestroy();
  await until(() => after.ended, 'shutdown closes');
  passed('signed token expiry and shutdown');
  console.log(
    `WhatsApp SSE integration passed: ${checks} groups; ${h.requests} REST requests.`,
  );
}
void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const s of streams) s.controller.abort();
    await Promise.allSettled(streams.map((s) => s.done));
    await h.close();
  });
