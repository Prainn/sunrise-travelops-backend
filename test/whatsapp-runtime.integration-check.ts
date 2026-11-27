import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { AddWhatsappRuntimeSettings1796256008000 } from '../src/migrations/1796256008000-AddWhatsappRuntimeSettings';
import { WhatsappEvents } from '../src/whatsapp/whatsapp.events';
import { WhatsappProvider } from '../src/whatsapp/whatsapp.provider';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { Actor, IsolationHarness, Page } from './business-isolation.harness';
import { ChatMessage, Conversation } from '../src/whatsapp/whatsapp.types';

const h = new IsolationHarness({
  WHATSAPP_CHAT_ENABLED: 'true',
  WHATSAPP_CHAT_RECEIVE_MODE: 'http',
  WHATSAPP_CHAT_WORKER_ENABLED: 'false',
  WHATSAPP_CHAT_SEND_ENABLED: 'true',
  WHATSAPP_CHAT_ENVIRONMENT: 'test',
  WHATSAPP_CHAT_TEST_RECIPIENTS: 'ZZ.runtime',
  WHATSAPP_CHAT_SPACE_ID: 'test-space',
  WHATSAPP_CHAT_WABA_ID: 'test-waba',
  WHATSAPP_CHAT_PHONE: '0000000000',
  WHATSAPP_CHAT_HTTP_TOKEN: 'synthetic-runtime-http-token-not-production',
});
type Switches = {
  version: number;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
};
async function main() {
  await h.start();
  const runner = h.db.createQueryRunner();
  await new AddWhatsappRuntimeSettings1796256008000().down(runner);
  await runner.release();
  await h.db.query('DELETE FROM migrations WHERE name=$1', [
    'AddWhatsappRuntimeSettings1796256008000',
  ]);
  const admin = await h.actor('headquarters', 'ROOT', null, undefined, 'mango');
  const manager = await h.actor('website', 'BUSINESS_MANAGER');
  const accountId = (await h.get(WhatsappEvents).account()).id;
  // Simulate pre-migration callback durability; previous application did not need this table.
  await h.db.query(
    "INSERT INTO whatsapp_events(account_id,event_key,payload,kind) VALUES($1,'old-runtime-event',$2,'inbound')",
    [
      accountId,
      {
        MessageId: 'old-runtime-event',
        From: 'ZZ.runtime',
        To: '0000000000',
        Type: 'TEXT',
        Message: 'older inbound',
        Timestamp: Date.now(),
      },
    ],
  );
  assert.equal((await h.db.runMigrations()).length, 1);
  assert.equal((await h.db.runMigrations()).length, 0);
  const events = h.get(WhatsappEvents);
  assert.equal(await events.processOne(), true);
  const response = await h.call<{ runtime: Switches }>(
    admin,
    'GET',
    '/whatsapp/integration',
  );
  assert.equal(response.runtime.inboundEnabled, true);
  assert.equal(response.runtime.outboundEnabled, true);
  const version = response.runtime.version;
  const put = (actor: Actor, body: unknown, status = 200, code = 'SUCCESS') =>
    h.call<Switches>(
      actor,
      'PUT',
      '/whatsapp/integration/runtime',
      body,
      status,
      code,
    );
  await put(manager, { version, inboundEnabled: false }, 403, 'AUTH_FORBIDDEN');
  await put(admin, { version }, 400, 'VALIDATION_ERROR');
  await put(
    admin,
    { version, environment: 'prod', inboundEnabled: false },
    400,
    'VALIDATION_ERROR',
  );
  const [chat] = await h.db.query<Conversation[]>(
    'SELECT id FROM whatsapp_conversations WHERE account_id=$1',
    [accountId],
  );
  const path = '/whatsapp/conversations/' + chat.id;
  const queued = await h.call<ChatMessage>(
    admin,
    'POST',
    path + '/messages',
    { clientRequestId: randomUUID(), text: 'queued' },
    201,
  );
  const disabled = await put(admin, { version, outboundEnabled: false });
  assert.equal(disabled.outboundEnabled, false);
  assert.equal(disabled.inboundEnabled, true);
  await put(admin, { version, inboundEnabled: false }, 409, 'CONFLICT');
  await h.call(
    admin,
    'POST',
    path + '/messages',
    { clientRequestId: randomUUID(), text: 'blocked' },
    409,
    'CONFLICT',
  );
  const detail = await h.call<{ sendBlockedReason: string }>(
    manager,
    'GET',
    path,
  );
  assert.equal(detail.sendBlockedReason, 'send_paused');
  let sends = 0;
  h.get(WhatsappProvider).send = () => {
    sends++;
    return Promise.resolve({
      status: 'accepted',
      providerId: 'synthetic-runtime-send',
    });
  };
  const service = h.get(WhatsappService);
  assert.equal(await service.dispatchOne(), false);
  assert.equal(sends, 0);
  const bothOff = await put(admin, {
    version: disabled.version,
    inboundEnabled: false,
  });
  await events.receive(
    {
      MessageId: 'held-inbound',
      From: 'ZZ.runtime',
      To: '0000000000',
      Type: 'TEXT',
      Message: 'preserved inbound',
      Timestamp: Date.now(),
    },
    'inbound',
  );
  await events.receive(
    {
      MessageId: 'callback-for-queued',
      TaskId: queued.id,
      From: '0000000000',
      To: 'ZZ.runtime',
      Status: 'Delivered',
      Timestamp: Date.now(),
    },
    'status',
  );
  assert.equal(await events.processOne(), true);
  assert.equal(await events.processOne(), false);
  const paused = await h.call<Page<ChatMessage>>(
    manager,
    'GET',
    path + '/messages',
  );
  assert.equal(
    paused.list.find((m) => m.id === queued.id)?.status,
    'delivered',
  );
  assert(!paused.list.some((m) => m.text === 'preserved inbound'));
  const inboundOnly = await put(admin, {
    version: bothOff.version,
    inboundEnabled: true,
  });
  assert.equal(inboundOnly.outboundEnabled, false);
  assert.equal(await events.processOne(), true);
  assert(
    (
      await h.call<Page<ChatMessage>>(manager, 'GET', path + '/messages')
    ).list.some((m) => m.text === 'preserved inbound'),
  );
  const config = h.get(ConfigService);
  config.set('WHATSAPP_CHAT_SEND_ENABLED', 'false');
  await put(
    admin,
    { version: inboundOnly.version, outboundEnabled: true },
    409,
    'CONFLICT',
  );
  config.set('WHATSAPP_CHAT_SEND_ENABLED', 'true');
  assert.equal(
    (await put(admin, { version: inboundOnly.version, outboundEnabled: true }))
      .outboundEnabled,
    true,
  );
  const restored = await h.call<{ runtime: Switches }>(
    admin,
    'GET',
    '/whatsapp/integration',
  );
  assert.equal(restored.runtime.outboundEnabled, true);
  console.log(
    'WhatsApp runtime: compatible migration, role/scope, optimistic lock, independent pause/resume, receipt continuity; ' +
      h.requests +
      ' HTTP requests',
  );
}
void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => h.close());
