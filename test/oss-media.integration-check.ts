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
  objectKey: string;
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
  assert.equal(draft.objectKey, `dev/whatsapp/${draft.id}/original.png`);
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
  const uploadPrefix = `dev/upload/${free.id}/`;
  assert.equal(free.objectKey, `${uploadPrefix}original.png`);
  assert.equal(
    free.originalUrl,
    `https://media.example.test/${free.objectKey}`,
  );
  assert.equal(
    free.thumbnailUrl,
    `https://media.example.test/${uploadPrefix}thumbnail.webp`,
  );
  assert(written.has(free.objectKey));
  assert(written.has(`${uploadPrefix}thumbnail.webp`));
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
  assert(!written.has(free.objectKey));
  assert(!written.has(`${uploadPrefix}thumbnail.webp`));
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
  const chat = `/whatsapp/conversations/${cid}`;
  const batchPath = `${chat}/image-message-batches`;
  const first = await upload(`${chat}/images`);
  const second = await upload(`${chat}/images`);
  const expired = await upload(`${chat}/images`);
  const fresh = await upload(`${chat}/images`);
  const managed = await upload('/system/oss/resources');
  const batch = {
    images: [first, second].map((image) => ({
      clientRequestId: randomUUID(),
      mediaAssetId: image.id,
    })),
    textMessage: { clientRequestId: randomUUID(), text: '  Separate text  ' },
    replyToMessageId: messages.list[0].id,
  };
  await h.call(
    actor,
    'POST',
    batchPath,
    {
      ...batch,
      images: [
        batch.images[0],
        { ...batch.images[1], mediaAssetId: randomUUID() },
      ],
    },
    404,
    'NOT_FOUND',
  );
  assert.equal(
    (await h.call<Page<ChatMessage>>(actor, 'GET', `${chat}/messages`)).total,
    3,
  );
  await h.call(
    actor,
    'POST',
    batchPath,
    {
      ...batch,
      textMessage: {
        ...batch.textMessage,
        replyToMessageId: messages.list[0].id,
      },
    },
    400,
    'VALIDATION_ERROR',
  );
  const sendBatch = (input = batch) =>
    h.call<{ messages: ChatMessage[] }>(actor, 'POST', batchPath, input, 201);
  const { messages: group } = await sendBatch();
  assert.deepEqual(
    group.map((m) => [m.kind, m.text, m.status]),
    [
      ['image', '', 'queued'],
      ['image', '', 'queued'],
      ['text', 'Separate text', 'queued'],
    ],
  );
  assert.deepEqual(
    group.slice(0, 2).map((m) => m.attachment?.mediaAssetId),
    [first.id, second.id],
  );
  assert.deepEqual(
    group.map((m) => m.attachment?.contextMessageId),
    ['old-media', undefined, undefined],
  );
  assert.equal(
    (group[0].attachment?.replyTo as { thumbnailUrl: string }).thumbnailUrl,
    archived.thumbnailUrl,
  );
  assert.deepEqual(
    (await sendBatch()).messages.map((m) => m.id),
    group.map((m) => m.id),
  );
  await h.call(
    actor,
    'POST',
    batchPath,
    { ...batch, images: [...batch.images].reverse() },
    409,
    'CONFLICT',
  );
  const laterPage = await h.call<Page<ChatMessage>>(
    actor,
    'GET',
    `${chat}/messages?afterSeq=${messages.list[0].seq}`,
  );
  const shown = laterPage.list.find((m) => m.id === group[0].id);
  assert.equal(
    (shown?.attachment?.replyTo as { thumbnailUrl: string }).thumbnailUrl,
    archived.thumbnailUrl,
  );

  const attempts: Parameters<WhatsappProvider['send']>[] = [];
  provider.send = (...args) => {
    attempts.push(args);
    return Promise.resolve({
      status: 'failed',
      errorCode: 'SYNTHETIC_FAILURE',
    });
  };
  const service = h.get(WhatsappService);
  // Explicit retry from the legacy single-image case is ahead of the batch.
  for (let i = 0; i < 4; i++) assert.equal(await service.dispatchOne(), true);
  assert.equal(await service.dispatchOne(), false);
  assert.deepEqual(
    attempts.slice(1).map((args) => [args[3], args[2], args[5], !!args[6]]),
    [
      [group[0].id, '', 'old-media', true],
      [group[1].id, '', undefined, true],
      [group[2].id, 'Separate text', undefined, false],
    ],
  );

  const protectedIds = [
    draft.id,
    first.id,
    second.id,
    archived.id,
    managed.id,
    prod.id,
  ];
  await h.db.query(
    `UPDATE oss_resources SET created_at=now()-interval '25 hours' WHERE id=ANY($1::uuid[])`,
    [[expired.id, ...protectedIds]],
  );
  const media = h.get(MediaService);
  const remove = storage.remove.bind(storage);
  storage.remove = () => Promise.reject(new Error('synthetic storage outage'));
  await assert.rejects(media.cleanupExpiredDraft(), /synthetic storage outage/);
  const [deleting] = await h.db.query<{ state: string }[]>(
    'SELECT state FROM oss_resources WHERE id=$1',
    [expired.id],
  );
  assert.equal(deleting.state, 'deleting');
  assert.equal(await media.cleanupExpiredDraft(), false);
  storage.remove = remove;
  await h.db.query('UPDATE oss_resources SET available_at=now() WHERE id=$1', [
    expired.id,
  ]);
  assert.equal(await media.cleanupExpiredDraft(), true);
  assert.equal(await media.cleanupExpiredDraft(), false);
  assert.equal(
    [...written.keys()].some((key) => key.includes(expired.id)),
    false,
  );
  assert.ok([...written.keys()].some((key) => key.includes(fresh.id)));
  const [kept] = await h.db.query<{ total: number }[]>(
    'SELECT count(*)::int AS total FROM oss_resources WHERE id=ANY($1::uuid[])',
    [[fresh.id, ...protectedIds]],
  );
  assert.equal(kept.total, protectedIds.length + 1);
  await h.call(
    actor,
    'POST',
    batchPath,
    {
      images: [{ clientRequestId: randomUUID(), mediaAssetId: expired.id }],
    },
    404,
    'NOT_FOUND',
  );
  console.log(
    `PASS media: old-data upgrade/repeat, archive/thumbnail, CRUD/CAS/references, scope/env, multipart validation, image idempotency/retry/provider, batch atomicity/order, quote thumbnail, expired draft recovery; ${h.requests} requests`,
  );
}
main()
  .finally(() => h.close())
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
