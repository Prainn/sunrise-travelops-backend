/** Disposable Postgres. No real OSS or WhatsApp sends. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { MAX_DOCUMENT_BYTES } from '../src/media/media.document-format';
import { MediaStorage } from '../src/media/media.storage';
import { WhatsappDocuments } from '../src/media/media.whatsapp-documents';
import type { MediaService } from '../src/media/media.service';
import { AddWhatsappDocuments1796256007000 } from '../src/migrations/1796256007000-AddWhatsappDocuments';
import { WhatsappEvents } from '../src/whatsapp/whatsapp.events';
import { WhatsappProvider } from '../src/whatsapp/whatsapp.provider';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { ChatMessage, Conversation } from '../src/whatsapp/whatsapp.types';
import { Actor, IsolationHarness, Page } from './business-isolation.harness';

const h = new IsolationHarness({
  WHATSAPP_CHAT_ENABLED: 'true',
  WHATSAPP_CHAT_WORKER_ENABLED: 'false',
  WHATSAPP_CHAT_RECEIVE_MODE: 'http',
  WHATSAPP_CHAT_SEND_ENABLED: 'true',
  WHATSAPP_CHAT_ENVIRONMENT: 'test',
  WHATSAPP_CHAT_TEST_RECIPIENTS: 'ZZ.doctest,ZZ.othertest',
  WHATSAPP_CHAT_SPACE_ID: 'test-space',
  WHATSAPP_CHAT_WABA_ID: 'test-waba',
  WHATSAPP_CHAT_PHONE: '0000000000',
  WHATSAPP_CHAT_HTTP_TOKEN: 'synthetic-documents-http-token-not-production',
  OSS_MEDIA_ENABLED: 'false',
});
type Draft = {
  id: string;
  fileName: string;
  sizeBytes: number;
  expiresAt: string;
};
type Batch = { messages: ChatMessage[] };

async function main() {
  await h.start();
  const runner = h.db.createQueryRunner();
  await new AddWhatsappDocuments1796256007000().down(runner);
  await runner.release();
  await h.db.query('DELETE FROM migrations WHERE name=$1', [
    'AddWhatsappDocuments1796256007000',
  ]);
  const manager = await h.actor('website', 'BUSINESS_MANAGER');
  const planner = await h.actor('website', 'COORDINATOR');
  const events = h.get(WhatsappEvents);
  for (const from of ['ZZ.doctest', 'ZZ.othertest']) {
    await events.receive(
      {
        MessageId: from,
        From: from,
        To: '0000000000',
        Type: 'TEXT',
        Message: from,
        Timestamp: Date.now(),
      },
      'inbound',
    );
    assert.equal(await events.processOne(), true);
  }
  // The previous version can write/read ordinary messages before the additive migration.
  assert.equal(
    (
      await h.call<Page<Conversation>>(
        manager,
        'GET',
        '/whatsapp/conversations',
      )
    ).total,
    2,
  );
  assert.equal((await h.db.runMigrations()).length, 1);
  assert.equal((await h.db.runMigrations()).length, 0);
  const chats = await h.call<Page<Conversation>>(
    manager,
    'GET',
    '/whatsapp/conversations',
  );
  assert.equal(chats.total, 2);
  const id = chats.list.find((row) => row.bsuid === 'ZZ.doctest')!.id;
  const otherId = chats.list.find((row) => row.id !== id)!.id;
  const path = '/whatsapp/conversations/' + id;
  const config = h.get(ConfigService);
  config.set('OSS_MEDIA_ENABLED', 'true');
  config.set('OSS_WHATSAPP_DOCUMENTS_ENABLED', 'true');
  config.set('OSS_MEDIA_ENVIRONMENT', 'dev');
  config.set('OSS_MEDIA_SOCKET', '/synthetic.sock');
  const objects = new Map<string, Buffer>();
  const storage = h.get(MediaStorage);
  storage.putDocument = (key, bytes) => {
    objects.set(key, bytes);
    return Promise.resolve({ etag: 'synthetic' });
  };
  storage.remove = (keys) => {
    keys.forEach((key) => objects.delete(key));
    return Promise.resolve({ deleted: true });
  };
  storage.signDocument = (key, purpose) => {
    assert(objects.has(key));
    return Promise.resolve({
      url:
        purpose === 'download'
          ? 'https://synthetic.example.test/' + purpose + '/' + key
          : 'https://sunrise-travelops-media.oss-cn-hangzhou.aliyuncs.com/' +
            key +
            '?synthetic-signature=1',
    });
  };
  const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');
  const upload = (
    file = pdf,
    name = '行程.PDF',
    code = 201,
    who: Actor = manager,
  ) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)]), name);
    return h.call<Draft>(
      who,
      'POST',
      path + '/documents',
      form,
      code,
      code === 400
        ? 'VALIDATION_ERROR'
        : code === 413
          ? 'PAYLOAD_TOO_LARGE'
          : 'SUCCESS',
    );
  };
  await upload(Buffer.from('plain text'), 'spoof.pdf', 400);
  await upload(Buffer.alloc(MAX_DOCUMENT_BYTES + 1), 'oversize.pdf', 413);
  const draft = await upload();
  const root = await h.actor('headquarters', 'ROOT', null, undefined, 'mango');
  const catalog = () =>
    h.call<Page<ReturnType<MediaService['present']>>>(
      root,
      'GET',
      '/system/oss/resources?kind=pdf&state=ready',
    );
  assert.equal((await catalog()).total, 0);
  assert.equal(draft.fileName, '行程.PDF');
  assert.equal(draft.sizeBytes, pdf.length);
  assert(new Date(draft.expiresAt).getTime() > Date.now());
  const key = 'private/dev/whatsapp/' + id + '/' + draft.id + '.pdf';
  assert.deepEqual(objects.get(key), pdf);
  const request = {
    documentId: draft.id,
    clientRequestId: randomUUID(),
    textMessage: { clientRequestId: randomUUID(), text: '附上您的行程。' },
  };
  const send = path + '/document-messages';
  await h.call(
    manager,
    'POST',
    '/whatsapp/conversations/' + otherId + '/document-messages',
    request,
    404,
    'NOT_FOUND',
  );
  await h.call(planner, 'POST', send, request, 404, 'NOT_FOUND');
  const otherManager = await h.actor('website', 'BUSINESS_MANAGER');
  await h.call(otherManager, 'POST', send, request, 404, 'NOT_FOUND');
  await h.call(
    manager,
    'POST',
    send,
    {
      ...request,
      textMessage: {
        ...request.textMessage,
        clientRequestId: request.clientRequestId,
      },
    },
    400,
    'VALIDATION_ERROR',
  );
  const conflict = (
    await h.call<Page<ChatMessage>>(manager, 'GET', path + '/messages')
  ).list[0];
  assert.equal(conflict.text, 'ZZ.doctest');
  const { messages } = await h.call<Batch>(manager, 'POST', send, request, 201);
  assert.deepEqual(
    messages.map((m) => [m.kind, m.text, m.status]),
    [
      ['document', '', 'queued'],
      ['text', '附上您的行程。', 'queued'],
    ],
  );
  assert(!JSON.stringify(messages).includes('synthetic.example.test'));
  const replay = await h.call<Batch>(manager, 'POST', send, request, 201);
  assert.deepEqual(
    replay.messages.map((m) => m.id),
    messages.map((m) => m.id),
  );
  await h.call(
    manager,
    'POST',
    send,
    { ...request, textMessage: { ...request.textMessage, text: 'changed' } },
    409,
    'CONFLICT',
  );
  await h.call(
    manager,
    'POST',
    send,
    { documentId: draft.id, clientRequestId: randomUUID() },
    409,
    'CONFLICT',
  );
  const download = path + '/messages/' + messages[0].id + '/document-download';
  assert.match(
    (await h.call<{ url: string }>(otherManager, 'GET', download)).url,
    /\/download\/private\/dev\/whatsapp\//,
  );
  await h.call(planner, 'GET', download, undefined, 404, 'NOT_FOUND');
  const abandoned = await upload(pdf, 'abandoned.pdf');
  await h.db.query(
    "UPDATE whatsapp_documents SET uploaded_at=now()-interval '25 hours' WHERE id=ANY($1::uuid[])",
    [[abandoned.id, draft.id]],
  );
  await h.call(
    manager,
    'POST',
    send,
    { documentId: abandoned.id, clientRequestId: randomUUID() },
    404,
    'NOT_FOUND',
  );
  const service = h.get(WhatsappDocuments);
  assert.equal(await service.cleanupExpiredDraft(), true);
  assert.equal(await service.cleanupExpiredDraft(), false);
  assert.deepEqual([...objects.keys()], [key]);
  const provider = h.get(WhatsappProvider);
  const order: string[] = [];
  const http = h.get(HttpAdapterHost).httpAdapter.getHttpServer() as Server;
  const address = http.address();
  assert(address && typeof address !== 'string');
  const originalFetch = globalThis.fetch;
  let storageReads = 0;
  globalThis.fetch = (input, options) => {
    const url =
      input instanceof URL
        ? input
        : typeof input === 'string'
          ? new URL(input)
          : new URL(input.url);
    if (
      url.hostname === 'sunrise-travelops-media.oss-cn-hangzhou.aliyuncs.com'
    ) {
      storageReads++;
      assert.equal(url.pathname, '/' + key);
      assert.equal(options?.redirect, 'error');
      return Promise.resolve(
        new Response(new Uint8Array(pdf), {
          headers: {
            'content-length': String(pdf.length),
            'content-type': 'application/pdf',
          },
        }),
      );
    }
    return originalFetch(input, options);
  };
  provider.send = async (
    _a,
    _recipient,
    text,
    _task,
    _reaction,
    _reply,
    _image,
    document,
  ) => {
    order.push(document?.fileName ?? text);
    if (document) {
      const providerUrl = new URL(document.link);
      assert(document.link.length < 200);
      assert.equal(providerUrl.origin, 'https://api-dev.sunrisevacation.cn');
      assert(providerUrl.pathname.endsWith('/file.pdf'));
      assert(!document.link.includes('aliyuncs.com'));
      const route = 'http://127.0.0.1:' + address.port + providerUrl.pathname;
      const head = await fetch(route, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-length'), String(pdf.length));
      assert.equal(head.headers.get('content-type'), 'application/pdf');
      assert.equal(storageReads, 0);
      const get = await fetch(route);
      assert.equal(get.status, 200);
      assert.equal(get.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(Buffer.from(await get.arrayBuffer()), pdf);
      assert.equal(storageReads, 1);
      assert.equal(
        (await fetch(route.replace(messages[0].id, randomUUID()))).status,
        404,
      );
      const tampered = await fetch(route.replace('/file.pdf', '/file.docx'));
      assert.equal(tampered.status, 404);
      assert(!(await tampered.text()).includes(providerUrl.pathname));
      const clock = Date.now;
      try {
        Date.now = () => clock() + 16 * 60_000;
        assert.equal((await fetch(route)).status, 404);
      } finally {
        Date.now = clock;
      }
      assert.equal(storageReads, 1);
      return {
        status: 'failed',
        errorCode: 'SYNTHETIC_FAILURE',
      };
    }
    return {
      status: 'accepted',
      providerId: 'synthetic-text-sent',
    };
  };
  try {
    assert.equal(await h.get(WhatsappService).dispatchOne(), true);
    assert.equal(await h.get(WhatsappService).dispatchOne(), true);
    const previewPath =
      path + '/messages/' + messages[0].id + '/document-preview';
    const preview = await fetch(h.url + previewPath, {
      headers: { authorization: 'Bearer ' + manager.token },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), 'application/pdf');
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), pdf);
    await h.call(
      manager,
      'GET',
      previewPath.replace(id, otherId),
      undefined,
      404,
      'NOT_FOUND',
    );
    await h.call(
      manager,
      'GET',
      previewPath.replace(messages[0].id, messages[1].id),
      undefined,
      404,
      'NOT_FOUND',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(order, ['行程.PDF', '附上您的行程。']);
  const retried = await h.call<ChatMessage>(
    manager,
    'POST',
    path + '/messages/' + messages[0].id + '/retry',
    { clientRequestId: randomUUID() },
    201,
  );
  assert.equal(retried.kind, 'document');
  assert.equal(retried.attachment?.documentId, draft.id);
  const files = await catalog();
  assert.equal(files.total, 1);
  const [file] = files.list;
  assert.equal(file.id, draft.id);
  assert.equal(file.name, draft.fileName);
  assert.equal(file.source, 'upload');
  assert.equal(file.referenceCount, 2);
  assert.deepEqual(file.documentMessage, {
    conversationId: id,
    messageId: retried.id,
  });
  assert.equal(file.originalUrl, null);
  assert.equal(await service.cleanupExpiredDraft(), false);
  console.log(
    'WhatsApp documents: additive upgrade, authorization, draft validation/expiry, idempotency, private links and outbox; ' +
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
