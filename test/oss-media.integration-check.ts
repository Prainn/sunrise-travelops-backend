/** Isolated database + synthetic media; no cloud writes or customer sends. */
import assert from 'node:assert/strict';
import { AddOssMedia1796256004000 } from '../src/migrations/1796256004000-AddOssMedia';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { IsolationHarness, Page } from './business-isolation.harness';
import { WhatsappEvents } from '../src/whatsapp/whatsapp.events';
import { WhatsappProvider } from '../src/whatsapp/whatsapp.provider';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { Conversation, ChatMessage } from '../src/whatsapp/whatsapp.types';
import { MediaService } from '../src/media/media.service';
import { MediaStorage } from '../src/media/media.storage';
import {
  MAX_IMAGE_BYTES,
  MAX_MANAGEMENT_IMAGE_BYTES,
  PROVIDER_MEDIA_ORIGIN,
} from '../src/media/media.images';

const h = new IsolationHarness(
  {
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
  },
  { mail: true },
);
type Resource = {
  id: string;
  name: string;
  remark: string;
  version: number;
  environment: string;
  state: string;
  referenceCount: number;
  originalUrl: string;
  thumbnailUrl: string;
  objectKey: string;
  clickable: boolean;
  previewable: boolean;
  source: string;
  kind: string;
  size: number;
  mailThreadId?: string;
};
async function main() {
  const threadId = randomUUID();
  const messageId = randomUUID();
  const mailFileId = randomUUID();
  const mailKey = `private/dev/email/${threadId}/${mailFileId}.bin`;
  await h.start({
    from: 1796256029000,
    seed: async () => {
      await h.db.query(
        `INSERT INTO mail_threads(id,mailbox,subject,customer_email,has_inbound,last_at)
         VALUES($1,'office@example.test','OSS test','client@example.test',true,now())`,
        [threadId],
      );
      await h.db.query(
        `INSERT INTO mail_messages(id,thread_id,direction,state,subject,sender)
         VALUES($1,$2,'inbound','received','OSS test','{}')`,
        [messageId, threadId],
      );
      await h.db.query(
        `INSERT INTO mail_attachments(id,message_id,file_name,size_bytes,object_key,removed_at)
         SELECT id,$2,name,24,'private/' || environment || '/email/' || $3::uuid || '/' || id || '.bin',removed_at
         FROM (VALUES ($1::uuid,'Catalog-mail.JPEG','dev',NULL::timestamptz),
                      (gen_random_uuid(),'Catalog-mail-pending.jpeg',NULL,NULL),
                      (gen_random_uuid(),'Catalog-mail-cross-env.jpeg','prod',NULL),
                      (gen_random_uuid(),'Catalog-mail-removed.jpeg','dev',now())
         ) AS fixtures(id,name,environment,removed_at)`,
        [mailFileId, messageId, threadId],
      );
    },
  });
  // Rebuild the media table from legacy messages, then reapply its size migration.
  const runner = h.db.createQueryRunner();
  await new AddOssMedia1796256004000().down(runner);
  await runner.release();
  await h.db.query('DELETE FROM migrations WHERE name=ANY($1::text[])', [
    ['AddOssMedia1796256004000', 'IncreaseOssManagementImageSize1796256030000'],
  ]);
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
  assert.equal((await h.db.runMigrations()).length, 2);
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
  const upload = async (path: string, content = bytes, status = 201) => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(content)], { type: 'image/png' }),
      'synthetic.png',
    );
    return h.call<Resource>(
      path.startsWith('/system') ? root : actor,
      'POST',
      path,
      form,
      status,
      status === 413 ? 'PAYLOAD_TOO_LARGE' : 'SUCCESS',
    );
  };
  const draft = await upload(`/whatsapp/conversations/${cid}/images`);
  assert.equal(draft.objectKey, `dev/whatsapp/${draft.id}/original.png`);
  const request = {
    images: [{ clientRequestId: randomUUID(), mediaAssetId: draft.id }],
  };
  const {
    messages: [sent],
  } = await h.call<{ messages: ChatMessage[] }>(
    actor,
    'POST',
    `/whatsapp/conversations/${cid}/image-message-batches`,
    request,
    201,
  );
  assert.equal(sent.kind, 'image');
  assert.equal(sent.status, 'queued');
  assert.equal(
    (
      await h.call<{ messages: ChatMessage[] }>(
        actor,
        'POST',
        `/whatsapp/conversations/${cid}/image-message-batches`,
        request,
        201,
      )
    ).messages[0].id,
    sent.id,
  );
  await h.call(
    actor,
    'POST',
    `/whatsapp/conversations/${cid}/image-message-batches`,
    {
      ...request,
      textMessage: { clientRequestId: randomUUID(), text: 'changed' },
    },
    409,
    'CONFLICT',
  );
  const provider = h.get(WhatsappProvider);
  let sends = 0;
  provider.send = (...args) => {
    sends++;
    assert.equal(args[6]?.caption, '');
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
  const largePng = await sharp(randomBytes(1536 * 1536 * 3), {
    raw: { width: 1536, height: 1536, channels: 3 },
  })
    .png()
    .toBuffer();
  assert(
    largePng.length > MAX_IMAGE_BYTES &&
      largePng.length <= MAX_MANAGEMENT_IMAGE_BYTES,
  );
  const largeManaged = await upload('/system/oss/resources', largePng);
  assert.equal(largeManaged.size, largePng.length);
  assert.deepEqual(written.get(largeManaged.objectKey), largePng);
  await upload(`${chat}/images`, largePng, 413);
  await upload(
    '/system/oss/resources',
    Buffer.alloc(MAX_MANAGEMENT_IMAGE_BYTES + 1),
    413,
  );
  await assert.rejects(
    h.db.query("UPDATE oss_resources SET source='upload' WHERE id=$1", [
      largeManaged.id,
    ]),
    /oss_resources_size_check/,
  );
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
  const mailRoot = await h.actor(
    'headquarters',
    'ROOT',
    null,
    undefined,
    'mango',
  );
  const catalog = '/system/oss/resources';
  const query = catalog + '?keyword=Catalog-mail&kind=image&state=ready';
  const mailPage = await h.call<Page<Resource>>(mailRoot, 'GET', query);
  assert.equal(mailPage.total, 1);
  assert.equal(
    (await h.call<Page<Resource>>(mailRoot, 'GET', query + '&page=2')).list
      .length,
    0,
  );
  const mail = await h.call<Resource>(
    mailRoot,
    'GET',
    catalog + '/' + mailFileId,
  );
  assert.deepEqual(mail, mailPage.list[0]);
  assert.equal(mail.previewable, true);
  assert.equal(mail.clickable, true);
  assert.deepEqual(
    [
      mail.source,
      mail.kind,
      mail.size,
      mail.mailThreadId,
      mail.version,
      mail.objectKey,
      mail.originalUrl,
    ],
    ['mail', 'image', 24, threadId, 1, null, null],
  );
  assert.equal(mail.remark, '');
  const attachmentPath = catalog + '/' + mail.id;
  await h.call(
    root,
    'PUT',
    attachmentPath,
    { version: 1, remark: 'hidden' },
    404,
    'NOT_FOUND',
  );
  await h.call(
    mailRoot,
    'PUT',
    attachmentPath,
    { version: 1, name: 'renamed.jpeg', remark: 'internal' },
    400,
    'VALIDATION_ERROR',
  );
  const saved = await h.call<Resource>(mailRoot, 'PUT', attachmentPath, {
    version: 1,
    remark: 'catalog note fixture',
  });
  assert.deepEqual(
    [saved.name, saved.remark, saved.version],
    [mail.name, 'catalog note fixture', 2],
  );
  const search = await h.call<Page<Resource>>(
    mailRoot,
    'GET',
    catalog + '?keyword=catalog%20note%20fixture',
  );
  assert.deepEqual(
    search.list.map((row) => row.id),
    [mail.id],
  );
  const changes = await Promise.all(
    ['updated', ''].map((remark) =>
      fetch(h.url + attachmentPath, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${mailRoot.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version: 2, remark }),
      }),
    ),
  );
  assert.deepEqual(
    changes.map((response) => response.status).sort(),
    [200, 409],
  );
  const latest = await h.call<Resource>(mailRoot, 'GET', attachmentPath);
  assert.equal(latest.version, 3);
  const cleared = await h.call<Resource>(mailRoot, 'PUT', attachmentPath, {
    version: 3,
    remark: '',
  });
  assert.deepEqual(
    [cleared.name, cleared.remark, cleared.version],
    [mail.name, '', 4],
  );
  assert.equal((await h.call<Page<Resource>>(root, 'GET', query)).total, 0);
  await h.call(
    root,
    'GET',
    catalog + '/' + mailFileId,
    undefined,
    404,
    'NOT_FOUND',
  );
  const mailDelete = `${attachmentPath}?version=${cleared.version}`;
  await h.call(root, 'DELETE', mailDelete, undefined, 404, 'NOT_FOUND');
  await h.call(mailRoot, 'DELETE', mailDelete, undefined, 409, 'CONFLICT');
  assert.deepEqual(await h.call(mailRoot, 'GET', attachmentPath), cleared);
  const downloadUrl = 'https://media.example.test/signed-mail-download';
  storage.signDocument = (key, purpose, name) => {
    assert.deepEqual(
      [key, purpose, name],
      [mailKey, 'download', 'Catalog-mail.JPEG'],
    );
    return Promise.resolve({ url: downloadUrl });
  };
  const download = `/mail/threads/${threadId}/attachments/${mailFileId}/download`;
  assert.deepEqual(await h.call(mailRoot, 'GET', download), {
    url: downloadUrl,
  });
  await h.call(root, 'GET', download, undefined, 403, 'AUTH_FORBIDDEN');
  const sourceImage = sharp(bytes);
  const inputs: [string, Buffer][] = [
    ['jpeg', await sourceImage.clone().jpeg().toBuffer()],
    ['png', bytes],
    ['webp', await sourceImage.clone().webp().toBuffer()],
    ['gif', await sourceImage.clone().gif().toBuffer()],
    ['avif', await sourceImage.clone().avif().toBuffer()],
    ['tif', await sourceImage.clone().tiff().toBuffer()],
  ];
  const origin = 'https://sunrise-travelops-media.oss-cn-hangzhou.aliyuncs.com';
  const archivedImages = new Map<string, Buffer>();
  storage.signDocument = (key) =>
    Promise.resolve({ url: origin + '/' + key + '?signed=fixture' });
  globalThis.fetch = (input, init) => {
    if (!(input instanceof URL) || input.origin !== origin)
      return originalFetch(input, init);
    const content = archivedImages.get(input.pathname.slice(1));
    assert(content);
    return Promise.resolve(
      new Response(new Uint8Array(content), {
        headers: { 'Content-Length': String(content.length) },
      }),
    );
  };
  try {
    const previewPath = (id: string) =>
      `/mail/threads/${threadId}/attachments/${id}/image-preview`;
    const preview = (path: string) =>
      fetch(h.url + path, {
        headers: { authorization: `Bearer ${mailRoot.token}` },
      });
    for (const [extension, content] of inputs) {
      const id = randomUUID();
      const key = `private/dev/email/${threadId}/${id}.bin`;
      archivedImages.set(key, content);
      await h.db.query(
        `INSERT INTO mail_attachments(id,message_id,file_name,size_bytes,object_key)
         VALUES($1,$2,$3,$4,$5)`,
        [id, messageId, `preview.${extension}`, content.length, key],
      );
      const result = await preview(previewPath(id));
      assert.equal(result.status, 200, extension);
      assert.equal(result.headers.get('content-type'), 'image/webp');
      assert.equal(result.headers.get('cache-control'), 'private, no-store');
      const meta = await sharp(
        Buffer.from(await result.arrayBuffer()),
      ).metadata();
      assert.deepEqual(
        [meta.format, meta.width, meta.height],
        ['webp', 320, 240],
        extension,
      );
      if (extension === 'jpeg') {
        const large = await preview(previewPath(id) + '?size=large');
        assert.equal(large.status, 200);
        const full = await sharp(
          Buffer.from(await large.arrayBuffer()),
        ).metadata();
        assert.deepEqual([full.width, full.height], [800, 600]);
        await h.call(
          root,
          'GET',
          previewPath(id),
          undefined,
          403,
          'AUTH_FORBIDDEN',
        );
        await h.call(
          await h.actor('website'),
          'GET',
          previewPath(id),
          undefined,
          404,
          'NOT_FOUND',
        );
        await h.call(
          mailRoot,
          'GET',
          previewPath(id) + '?size=unknown',
          undefined,
          400,
          'VALIDATION_ERROR',
        );
      }
    }
    const invalidBytes = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    );
    archivedImages.set(mailKey, invalidBytes);
    await h.db.query('UPDATE mail_attachments SET size_bytes=$2 WHERE id=$1', [
      mailFileId,
      invalidBytes.length,
    ]);
    await h.call(
      mailRoot,
      'GET',
      previewPath(mailFileId),
      undefined,
      400,
      'VALIDATION_ERROR',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(
    `PASS media: old-data upgrade/repeat, archive/thumbnail, CRUD/CAS/references, scope/env, multipart validation, image idempotency/retry/provider, batch atomicity/order, quote thumbnail, expired draft recovery, private mail catalog, remarks, download and preview; ${h.requests} requests`,
  );
}
main()
  .finally(() => h.close())
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
