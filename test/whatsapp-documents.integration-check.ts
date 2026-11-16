/** Disposable Postgres. No real OSS or WhatsApp sends. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { MAX_DOCUMENT_BYTES } from '../src/media/media.document-format';
import { MediaStorage } from '../src/media/media.storage';
import { WhatsappDocuments } from '../src/media/media.whatsapp-documents';
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
      url: 'https://synthetic.example.test/' + purpose + '/' + key,
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
          ? 'INTERNAL_SERVER_ERROR'
          : 'SUCCESS',
    );
  };
  await upload(Buffer.from('plain text'), 'spoof.pdf', 400);
  await upload(Buffer.alloc(MAX_DOCUMENT_BYTES + 1), 'oversize.pdf', 413);
  const draft = await upload();
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
  provider.send = (
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
      assert.match(document.link, /\/send\/private\/dev\/whatsapp\//);
      return Promise.resolve({
        status: 'failed',
        errorCode: 'SYNTHETIC_FAILURE',
      });
    }
    return Promise.resolve({
      status: 'accepted',
      providerId: 'synthetic-text-sent',
    });
  };
  assert.equal(await h.get(WhatsappService).dispatchOne(), true);
  assert.equal(await h.get(WhatsappService).dispatchOne(), true);
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
