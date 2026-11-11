/** Isolated PostgreSQL and synthetic callbacks; never sends provider messages. */
import assert from 'node:assert/strict';
import { IsolationHarness, Page } from './business-isolation.harness';
import { WhatsappEvents } from '../src/whatsapp/whatsapp.events';
import { ChatMessage, Conversation } from '../src/whatsapp/whatsapp.types';

const h = new IsolationHarness({
  WHATSAPP_CHAT_ENABLED: 'true',
  WHATSAPP_CHAT_WORKER_ENABLED: 'false',
  WHATSAPP_CHAT_RECEIVE_MODE: 'http',
  WHATSAPP_CHAT_SEND_ENABLED: 'false',
  WHATSAPP_CHAT_ENVIRONMENT: 'test',
  WHATSAPP_CHAT_SPACE_ID: 'test-space',
  WHATSAPP_CHAT_WABA_ID: 'test-waba',
  WHATSAPP_CHAT_PHONE: '0000000000',
  WHATSAPP_CHAT_HTTP_TOKEN: 'synthetic-context-http-token-not-a-production-key',
  WHATSAPP_CHAT_SOURCE_TOKEN:
    'synthetic-context-source-token-not-a-production-key',
});
async function main() {
  await h.start();
  const actor = await h.actor('website', 'BUSINESS_MANAGER');
  const events = h.get(WhatsappEvents);
  const payload = (id: string, extra: Record<string, unknown> = {}) => ({
    MessageId: id,
    CustSpaceId: 'test-space',
    WabaId: 'test-waba',
    FromUserId: 'ZZ.synthetic',
    From: 'ZZ.synthetic',
    To: '0000000000',
    Type: 'TEXT',
    Message: id,
    Timestamp: Date.now(),
    ...extra,
  });
  const receive = async (id: string, extra: Record<string, unknown> = {}) => {
    await events.receive(payload(id, extra), 'inbound');
    assert.equal(await events.processOne(), true);
  };
  await receive('original', {
    NoticeType: 'echos',
    From: '0000000000',
    To: 'ZZ.synthetic',
    UserId: 'ZZ.synthetic',
    Message: 'Original preview',
  });
  await receive('reply', { Context: { id: 'original' } });
  const conversations = await h.call<Page<Conversation>>(
    actor,
    'GET',
    '/whatsapp/conversations',
  );
  const id = conversations.list[0].id;
  const read = (query = '') =>
    h.call<Page<ChatMessage>>(
      actor,
      'GET',
      `/whatsapp/conversations/${id}/messages${query}`,
    );
  const quoted = (m: ChatMessage) =>
    m.attachment?.replyTo as Record<string, unknown> | undefined;
  let page = await read('?pageSize=1');
  assert.equal(page.list.length, 1);
  assert.equal(page.list[0].providerId, 'reply');
  assert.deepEqual(quoted(page.list[0]), {
    id: (
      await h.db.query<{ id: string }[]>(
        "SELECT id FROM whatsapp_messages WHERE provider_id='original'",
      )
    )[0].id,
    text: 'Original preview',
    kind: 'text',
    direction: 'outbound',
    source: 'mobile',
  });
  // Simulate the exact pre-fix row; only the saved callback retains Context.
  await h.db.query(
    "UPDATE whatsapp_messages SET attachment=NULL WHERE provider_id='reply'",
  );
  assert.equal(
    quoted((await read('?pageSize=1')).list[0])?.text,
    'Original preview',
  );
  assert.equal(
    (
      await h.db.query<{ attachment: unknown }[]>(
        "SELECT attachment FROM whatsapp_messages WHERE provider_id='reply'",
      )
    )[0].attachment,
    null,
  );
  await receive('reply', { Context: { id: 'original' } });
  assert.equal((await read()).total, 2);
  await receive('media-reply', {
    Type: 'IMAGE',
    Message: { id: 'media' },
    Context: { id: 'original' },
  });
  page = await read('?pageSize=1');
  assert.equal(page.list[0].attachment?.id, 'media');
  assert.equal(quoted(page.list[0])?.text, 'Original preview');
  await receive('late-reply', { Context: { id: 'late-original' } });
  assert.equal(quoted((await read('?pageSize=1')).list[0]), undefined);
  await receive('late-original');
  assert.equal(
    quoted((await read()).list.find((m) => m.providerId === 'late-reply')!)
      ?.text,
    'late-original',
  );
  await receive('other-original', { From: 'ZZ.other', FromUserId: 'ZZ.other' });
  await receive('cross-reply', { Context: { id: 'other-original' } });
  assert.equal(quoted((await read('?pageSize=1')).list[0]), undefined);
  const outsider = await h.actor('linxi', 'BUSINESS_MANAGER');
  await h.call(
    outsider,
    'GET',
    `/whatsapp/conversations/${id}/messages`,
    undefined,
    403,
    'AUTH_FORBIDDEN',
  );
  console.log(
    `PASS Context: new/legacy, off-page, media, duplicate, late target, conversation isolation, permission; ${h.requests} HTTP requests`,
  );
}
main()
  .finally(() => h.close())
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
