/** Isolated database + synthetic media; no cloud writes or customer sends. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { IsolationHarness, Page } from './business-isolation.harness';
import { WhatsappEvents } from '../src/whatsapp/whatsapp.events';
import { WhatsappProvider } from '../src/whatsapp/whatsapp.provider';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { Conversation, ChatMessage } from '../src/whatsapp/whatsapp.types';
import { MediaService } from '../src/media/media.service';
import { MediaStorage } from '../src/media/media.storage';
import { PROVIDER_MEDIA_ORIGIN } from '../src/media/media.images';

const h = new IsolationHarness({
  WHATSAPP_CHAT_ENABLED: 'true',
  WHATSAPP_CHAT_WORKER_ENABLED: 'false',
  WHATSAPP_CHAT_RECEIVE_MODE: 'http',
  WHATSAPP_CHAT_SEND_ENABLED: 'true',
  WHATSAPP_CHAT_ENVIRONMENT: 'test',
  WHATSAPP_CHAT_TEST_RECIPIENTS: 'ZZ.synthetic',
  WHATSAPP_CHAT_SPACE_ID: 'test-space',
  WHATSAPP_CHAT_WABA_ID: 'test-waba',
  WHATSAPP_CHAT_PHONE: '0000000000',
  WHATSAPP_CHAT_HTTP_TOKEN: 'synthetic-media-http-token-not-production-0000',
  WHATSAPP_CHAT_SOURCE_TOKEN:
    'synthetic-media-source-token-not-production-0000',
  OSS_MEDIA_ENABLED: 'false',
});
type Resource = {
  id: string;
  version: number;
  environment: string;
  state: string;
  referenceCount: number;
  originalUrl: string;
  thumbnailUrl: string;
  clickable: boolean;
};
async function main() {
  await h.start();
  // Roll back only this new additive migration in a disposable DB, then seed pre-upgrade messages.
  const last = (
    await h.db.query<{ name: string }[]>(
      'SELECT name FROM migrations ORDER BY id DESC LIMIT 1',
    )
  )[0].name;
  assert.equal(last, 'AddOssMedia1796256004000');
  await h.db.undoLastMigration();
  const root = await h.actor('headquarters', 'ROOT'),
    boss = await h.actor('headquarters', 'BOSS'),
    actor = await h.actor('website', 'BUSINESS_MANAGER');
  const events = h.get(WhatsappEvents);
  await events.receive(
    {
      MessageId: 'old-media',
      CustSpaceId: 'test-space',
      WabaId: 'test-waba',
      From: 'ZZ.synthetic',
      FromUserId: 'ZZ.synthetic',
      To: '0000000000',
      Type: 'IMAGE',
      Message: { fileUrl: PROVIDER_MEDIA_ORIGIN + '/synthetic.png' },
      Timestamp: Date.now(),
    },
    'inbound',
  );
  assert.equal(await events.processOne(), true);
  assert.equal((await h.db.runMigrations()).length, 1);
  assert.equal((await h.db.runMigrations()).length, 0);
  const cid = (
    await h.call<Page<Conversation>>(actor, 'GET', '/whatsapp/conversations')
  ).list[0].id;
  const config = h.get(ConfigService);
  config.set('OSS_MEDIA_ENABLED', 'true');
  config.set('OSS_MEDIA_ENVIRONMENT', 'dev');
  config.set('OSS_MEDIA_SOCKET', '/synthetic.sock');
  config.set('OSS_MEDIA_PUBLIC_ORIGIN', 'https://media.example.test');
  const storage = h.get(MediaStorage);
  const written = new Map<string, Buffer>();
  storage.put = (key, bytes) => {
    written.set(key, bytes);
    return Promise.resolve({ etag: 'synthetic' });
  };
  storage.remove = (keys) => {
    keys.forEach((key) => written.delete(key));
    return Promise.resolve({ deleted: true });
  };
  const bytes = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#0088ff' },
  })
    .png()
    .toBuffer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) =>
    typeof input === 'string' && input.startsWith(PROVIDER_MEDIA_ORIGIN)
      ? Promise.resolve(new Response(new Uint8Array(bytes)))
      : originalFetch(input, init);
  try {
    assert.equal(await h.get(MediaService).processOne(), true);
    assert.equal(await h.get(MediaService).processOne(), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const page = await h.call<Page<Resource>>(
    root,
    'GET',
    '/system/oss/resources',
  );
  assert.equal(page.total, 1);
  const archived = page.list[0];
  assert.equal(archived.state, 'ready');
  assert.equal(archived.referenceCount, 1);
  assert.match(archived.originalUrl, /\/dev\/whatsapp\//);
  assert.notEqual(archived.originalUrl, archived.thumbnailUrl);
  const messages = await h.call<Page<ChatMessage>>(
    actor,
    'GET',
    `/whatsapp/conversations/${cid}/messages`,
  );
  assert.equal(messages.total, 1);
  assert.equal(
    (messages.list[0].attachment?.media as Resource).id,
    archived.id,
  );
  await h.call(
    root,
    'DELETE',
    `/system/oss/resources/${archived.id}?version=${archived.version}`,
    undefined,
    409,
    'CONFLICT',
  );
  await h.call(
    boss,
    'GET',
    '/system/oss/resources',
    undefined,
    403,
    'AUTH_FORBIDDEN',
  );
  await h.call(
    actor,
    'GET',
    '/system/oss/resources',
    undefined,
    403,
    'AUTH_FORBIDDEN',
  );
  const upload = async (path: string) => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      'synthetic.png',
    );
    return h.call<Resource>(
      path.startsWith('/system') ? root : actor,
      'POST',
      path,
      form,
      201,
    );
  };
  const draft = await upload(`/whatsapp/conversations/${cid}/images`);
  const request = {
    clientRequestId: randomUUID(),
    mediaAssetId: draft.id,
    caption: 'synthetic caption',
  };
  const sent = await h.call<ChatMessage>(
    actor,
    'POST',
    `/whatsapp/conversations/${cid}/image-messages`,
    request,
    201,
  );
  assert.equal(sent.kind, 'image');
  assert.equal(sent.status, 'queued');
  assert.equal(
    (
      await h.call<ChatMessage>(
        actor,
        'POST',
        `/whatsapp/conversations/${cid}/image-messages`,
        request,
        201,
      )
    ).id,
    sent.id,
  );
  await h.call(
    actor,
    'POST',
    `/whatsapp/conversations/${cid}/image-messages`,
    { ...request, caption: 'changed' },
    409,
    'CONFLICT',
  );
  const provider = h.get(WhatsappProvider);
  let sends = 0;
  provider.send = (...args) => {
    sends++;
    assert.equal(args[6]?.caption, 'synthetic caption');
    assert.match(args[6].link, /^https:\/\/media.example.test\/dev\//);
    return Promise.resolve({
      status: 'failed',
      errorCode: 'SYNTHETIC_FAILURE',
    });
  };
  assert.equal(await h.get(WhatsappService).dispatchOne(), true);
  assert.equal(sends, 1);
  const retry = await h.call<ChatMessage>(
    actor,
    'POST',
    `/whatsapp/conversations/${cid}/messages/${sent.id}/retry`,
    { clientRequestId: randomUUID() },
    201,
  );
  assert.equal(retry.kind, 'image');
  assert.equal(retry.attachment?.mediaAssetId, draft.id);
  const free = await upload('/system/oss/resources');
  const edited = await h.call<Resource>(
    root,
    'PUT',
    `/system/oss/resources/${free.id}`,
    { name: 'Renamed', remark: 'test', version: free.version },
  );
  assert.equal(edited.version, free.version + 1);
  await h.call(
    root,
    'PUT',
    `/system/oss/resources/${free.id}`,
    { name: 'stale', version: free.version },
    409,
    'CONFLICT',
  );
  await h.call(
    root,
    'DELETE',
    `/system/oss/resources/${free.id}?version=${edited.version}`,
  );
  await h.call(
    root,
    'GET',
    `/system/oss/resources/${free.id}`,
    undefined,
    404,
    'NOT_FOUND',
  );
  const [prod] = await h.db.query<{ id: string }[]>(
    "INSERT INTO oss_resources(environment,name,kind,source) VALUES('prod','invisible','image','management') RETURNING id",
  );
  await h.call(
    root,
    'GET',
    `/system/oss/resources/${prod.id}`,
    undefined,
    404,
    'NOT_FOUND',
  );
  await h.call(
    root,
    'DELETE',
    `/system/oss/resources/${prod.id}?version=1`,
    undefined,
    404,
    'NOT_FOUND',
  );
  const invalid = new FormData();
  invalid.append(
    'file',
    new Blob(['<html>bad</html>'], { type: 'image/png' }),
    'bad.png',
  );
  await h.call(
    root,
    'POST',
    '/system/oss/resources',
    invalid,
    400,
    'VALIDATION_ERROR',
  );
  console.log(
    `PASS media: old-data upgrade/repeat, archive/thumbnail, CRUD/CAS/references, scope/env, multipart validation, image idempotency/retry/provider; ${h.requests} requests`,
  );
}
main()
  .finally(() => h.close())
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
