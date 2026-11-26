/** Real callback, queue, PostgreSQL and JWT/HTTP. Only the two object stores are simulated. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { ConfigService } from '@nestjs/config';
import { WhatsappDocumentArchive } from '../src/media/media.document-archive';
import {
  DOC_MIME,
  MAX_DOCUMENT_BYTES,
} from '../src/media/media.document-format';
import { PROVIDER_MEDIA_ORIGIN } from '../src/media/media.images';
import { MediaStorage } from '../src/media/media.storage';
import type { MediaService } from '../src/media/media.service';
import { AddWhatsappDocumentArchives1796256011000 } from '../src/migrations/1796256011000-AddWhatsappDocumentArchives';
import { WhatsappEvents } from '../src/whatsapp/whatsapp.events';
import { ChatMessage, Conversation } from '../src/whatsapp/whatsapp.types';
import { IsolationHarness, Page } from './business-isolation.harness';

const h = new IsolationHarness({
  WHATSAPP_CHAT_ENABLED: 'true',
  WHATSAPP_CHAT_WORKER_ENABLED: 'false',
  WHATSAPP_CHAT_RECEIVE_MODE: 'http',
  WHATSAPP_CHAT_SEND_ENABLED: 'false',
  WHATSAPP_CHAT_ENVIRONMENT: 'test',
  WHATSAPP_CHAT_SPACE_ID: 'test-space',
  WHATSAPP_CHAT_WABA_ID: 'test-waba',
  WHATSAPP_CHAT_PHONE: '0000000000',
  WHATSAPP_CHAT_HTTP_TOKEN: 'synthetic-documents-http-token-not-production',
  OSS_MEDIA_ENABLED: 'false',
});

// A stored ZIP with a large middle entry makes directory-only identification observable.
function officeZip(path: string) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of [
    ['[Content_Types].xml', Buffer.from('<Types/>')],
    ['media/data', Buffer.alloc(150000)],
    [path, Buffer.from('<document/>')],
  ] as const) {
    const nameBytes = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    header.copy(entry, 6, 4, 30);
    entry.writeUInt32LE(offset, 42);
    local.push(header, nameBytes, data);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(3, 8);
  end.writeUInt16LE(3, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function compoundFixture(streamName: string) {
  const bytes = Buffer.alloc(2048);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(bytes);
  bytes.writeUInt16LE(9, 30);
  bytes.writeUInt32LE(0, 48);
  bytes.writeUInt32LE(1, 76);
  const entry = Buffer.from(streamName + '\0', 'utf16le');
  entry.copy(bytes, 512 + 128);
  bytes.writeUInt16LE(entry.length, 512 + 128 + 64);
  bytes[512 + 128 + 66] = 2;
  bytes.writeUInt32LE(0xfffffffe, 1024);
  return bytes;
}

const pdf = Buffer.from('%PDF-1.5\n%%EOF\n');
const docx = officeZip('word/document.xml'),
  doc = compoundFixture('WordDocument');
const providerFiles = new Map([
  ['pdf', pdf],
  ['docx', docx],
  ['doc', doc],
  ['html', Buffer.alloc(150000, '<html>')],
  ['sheet', officeZip('xl/workbook.xml')],
  ['ole-sheet', compoundFixture('Workbook')],
]);
const privateFiles = new Map<string, Buffer>();
const privateOrigin =
  'https://sunrise-travelops-media.oss-cn-hangzhou.aliyuncs.com';
const transfers = new Map<string, { full: number; bytes: number }>();
const originalFetch = globalThis.fetch;
let storageFault: 'unavailable' | 'truncated' | undefined;

function interceptStores() {
  const storage = h.get(MediaStorage);
  storage.putDocument = (key, bytes) => {
    privateFiles.set(key, Buffer.from(bytes));
    return Promise.resolve({ etag: 'synthetic' });
  };
  storage.signDocument = (key, purpose, name) => {
    assert(name.toLowerCase().endsWith('.' + key.split('.').at(-1)!));
    return Promise.resolve({
      url: privateOrigin + '/' + key + '?purpose=' + purpose,
    });
  };
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin === privateOrigin) {
      const bytes = privateFiles.get(url.pathname.slice(1));
      assert(bytes);
      assert.equal(url.search, '?purpose=send');
      return Promise.resolve(
        storageFault === 'unavailable'
          ? new Response(null, { status: 503 })
          : new Response(
              new Uint8Array(
                storageFault === 'truncated' ? bytes.subarray(1) : bytes,
              ),
              {
                headers: {
                  'content-length': String(bytes.length),
                  'content-type': 'text/html',
                },
              },
            ),
      );
    }
    if (url.origin !== PROVIDER_MEDIA_ORIGIN) {
      assert.equal(url.hostname, '127.0.0.1');
      return originalFetch(input, init);
    }
    assert.equal(init?.redirect, 'error');
    const name = url.pathname.slice(1);
    if (name === 'expired')
      return Promise.resolve(new Response(null, { status: 403 }));
    if (name === 'temporary' || name === 'historical')
      return Promise.resolve(new Response(null, { status: 503 }));
    if (name === 'oversize')
      return Promise.resolve(
        new Response(null, {
          status: 206,
          headers: {
            'content-range': 'bytes 0-511/' + (MAX_DOCUMENT_BYTES + 1),
          },
        }),
      );
    const bytes = providerFiles.get(name)!;
    assert(bytes);
    const requests = transfers.get(name) ?? { full: 0, bytes: 0 };
    transfers.set(name, requests);
    const range = new Headers(init?.headers).get('range');
    if (range) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)!;
      assert(match);
      const start = Number(match[1]),
        end = Math.min(Number(match[2]), bytes.length - 1);
      const part = bytes.subarray(start, end + 1);
      requests.bytes += part.length;
      return Promise.resolve(
        new Response(new Uint8Array(part), {
          status: 206,
          headers: {
            'content-range': `bytes ${start}-${end}/${bytes.length}`,
            'content-length': String(part.length),
          },
        }),
      );
    }
    requests.full++;
    requests.bytes += bytes.length;
    return Promise.resolve(
      new Response(new Uint8Array(bytes), {
        headers: { 'content-length': String(bytes.length) },
      }),
    );
  };
}

async function incoming(name: string, fileName: string) {
  const events = h.get(WhatsappEvents);
  const raw = {
    fileName,
    fileUrl: PROVIDER_MEDIA_ORIGIN + '/' + name + '?synthetic=1',
    mimeType: 'text/html',
    caption: '客户文件',
    nested: { link: privateOrigin + '/?signature=private', keep: 1 },
    document: { id: randomUUID() },
    documentArchive: { state: 'available' },
  };
  await events.receive(
    {
      MessageId: name,
      From: 'ZZ.archivetest',
      To: '0000000000',
      Type: 'DOCUMENT',
      Message: raw,
      Timestamp: Date.now(),
    },
    'inbound',
  );
  assert.equal(await events.processOne(), true);
  return raw;
}

async function main() {
  await h.start();
  const migration = new AddWhatsappDocumentArchives1796256011000();
  const runner = h.db.createQueryRunner();
  try {
    await migration.down(runner);
    await runner.query('DELETE FROM migrations WHERE name=$1', [
      migration.constructor.name,
    ]);
  } finally {
    await runner.release();
  }
  await incoming('historical', '历史.pdf');
  assert.deepEqual(
    (await h.db.runMigrations()).map((m) => m.name),
    [migration.constructor.name],
  );
  assert.equal((await h.db.runMigrations()).length, 0);
  const config = h.get(ConfigService);
  config.set('OSS_MEDIA_ENVIRONMENT', 'dev');
  config.set('OSS_MEDIA_ENABLED', 'true');
  config.set('OSS_WHATSAPP_DOCUMENTS_ENABLED', 'true');
  config.set('OSS_MEDIA_SOCKET', '/synthetic.sock');
  interceptStores();
  const manager = await h.actor('website', 'BUSINESS_MANAGER'),
    planner = await h.actor('website', 'COORDINATOR');
  const id = (
    await h.call<Page<Conversation>>(manager, 'GET', '/whatsapp/conversations')
  ).list[0].id;
  const base = '/whatsapp/conversations/' + id + '/messages';
  const archive = h.get(WhatsappDocumentArchive);
  const list = async (query = '') =>
    (await h.call<Page<ChatMessage>>(manager, 'GET', base + query)).list;
  const state = (msg: ChatMessage) => msg.attachment?.documentArchive;
  const docRoute = (msg: ChatMessage, action: 'preview' | 'download') =>
    base + '/' + msg.id + '/document-' + action;

  assert(await archive.processOne());
  const [old] = await list();
  assert.deepEqual(state(old), {
    state: 'failed',
    errorCode: 'MEDIA_DOWNLOAD_FAILED',
  });
  assert.equal(await archive.processOne(), false);
  await h.call(
    manager,
    'GET',
    docRoute(old, 'download'),
    undefined,
    404,
    'NOT_FOUND',
  );
  const raw = await incoming('pdf', "报价('终').txt");
  const [pending] = await list('?afterSeq=' + old.seq);
  assert.deepEqual(state(pending), { state: 'pending' });
  assert.equal(pending.attachment?.document, undefined);
  assert(!JSON.stringify(pending).includes('https://'));
  assert.deepEqual(pending.attachment?.nested, { keep: 1 });
  for (const action of ['preview', 'download'] as const)
    await h.call(
      manager,
      'GET',
      docRoute(pending, action),
      undefined,
      404,
      'NOT_FOUND',
    );

  const listener = h.db.createQueryRunner();
  const pg = (await listener.connect()) as {
    on(name: 'notification', cb: (v: { payload: string }) => void): void;
  };
  const notices: string[] = [];
  pg.on('notification', (v) => notices.push(v.payload));
  await listener.query('LISTEN whatsapp_changes');
  try {
    let releaseRead!: () => void, announceRead!: () => void;
    const readStarted = new Promise<void>((r) => {
      announceRead = r;
    });
    const allowRead = new Promise<void>((r) => {
      releaseRead = r;
    });
    const fetchStores = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (
        typeof input === 'string' &&
        input.startsWith(PROVIDER_MEDIA_ORIGIN)
      ) {
        announceRead();
        await allowRead;
      }
      return fetchStores(input, init);
    };
    const running = archive.processOne();
    try {
      await readStarted;
      assert.deepEqual(state((await list())[0]), { state: 'processing' });
      assert.equal(await archive.processOne(), false);
    } finally {
      releaseRead();
      globalThis.fetch = fetchStores;
      await running;
    }
    await listener.query('SELECT 1');
    assert.equal(
      notices.filter(
        (v) => v === JSON.stringify({ conversationId: id, reason: 'message' }),
      ).length,
      2,
    );
  } finally {
    await listener.query('UNLISTEN whatsapp_changes');
    await listener.release();
  }
  for (const [name, file] of [
    ['doc', '条款.doc'],
    ['docx', '行程.docx'],
    ['html', '假.pdf'],
    ['sheet', '假.docx'],
    ['ole-sheet', '假.doc'],
    ['expired', '过期.pdf'],
    ['oversize', '大.pdf'],
    ['temporary', '暂时.pdf'],
  ]) {
    await incoming(name, file);
    assert(await archive.processOne());
  }
  for (let i = 1; i < 5; i++) {
    await h.db.query(
      "UPDATE whatsapp_document_archives SET available_at=now() WHERE state='pending'",
    );
    assert(await archive.processOne());
  }
  assert.equal(await archive.processOne(), false);
  const rows = await list(),
    byName = new Map(rows.map((m) => [m.providerId, m]));
  for (const name of ['html', 'sheet', 'ole-sheet']) {
    const message = byName.get(name)!;
    assert.deepEqual(state(message), { state: 'skipped' });
    assert.equal(message.attachment?.document, undefined);
    assert.equal(transfers.get(name)?.full, 0);
    await h.call(
      manager,
      'GET',
      docRoute(message, 'download'),
      undefined,
      404,
      'NOT_FOUND',
    );
  }
  assert(transfers.get('sheet')!.bytes < providerFiles.get('sheet')!.length);
  for (const [id, code] of [
    ['expired', 'MEDIA_SOURCE_EXPIRED'],
    ['oversize', 'DOCUMENT_TOO_LARGE'],
    ['temporary', 'MEDIA_DOWNLOAD_FAILED'],
  ]) {
    assert.deepEqual(state(byName.get(id)!), {
      state: 'failed',
      errorCode: code,
    });
  }
  const records = await h.db.query<{ provider_id: string; attempts: number }[]>(
    `SELECT m.provider_id,a.attempts FROM whatsapp_document_archives a JOIN whatsapp_messages m ON m.id=a.message_id`,
  );
  assert.equal(records.find((r) => r.provider_id === 'temporary')?.attempts, 5);
  assert.equal(
    records.find((r) => r.provider_id === 'historical')?.attempts,
    1,
  );
  assert.equal(records.find((r) => r.provider_id === 'expired')?.attempts, 1);
  assert.equal(rows.length, 10);
  assert.equal(privateFiles.size, 3);
  const root = await h.actor('headquarters', 'ROOT', null, undefined, 'mango');
  const ossOnly = await h.actor('headquarters', 'ROOT');
  const catalog = '/system/oss/resources';
  type CatalogItem = ReturnType<MediaService['present']>;
  const files = (query: string) =>
    h.call<Page<CatalogItem>>(root, 'GET', catalog + query);
  await h.db.query(
    "INSERT INTO oss_resources(environment,name,kind,source) VALUES('dev','image','image','management')",
  );
  const firstPage = await files('?pageSize=2');
  const secondPage = await files('?pageSize=2&page=2');
  assert.equal(firstPage.total, 4);
  assert.equal(secondPage.total, 4);
  assert.deepEqual(
    [...firstPage.list, ...secondPage.list].map((r) => r.kind).sort(),
    ['image', 'pdf', 'word', 'word'],
  );
  const words = await files('?kind=word&state=ready');
  assert.deepEqual(words.list.map((r) => r.extension).sort(), ['doc', 'docx']);
  const result = await files('?kind=pdf&keyword=' + encodeURIComponent('报价'));
  assert.equal(result.total, 1);
  const [item] = result.list;
  assert.equal(item.id, pending.id);
  assert.equal(item.referenceCount, 1);
  assert.equal(item.size, pdf.length);
  assert.equal(item.originalUrl, null);
  assert.equal(item.thumbnailUrl, null);
  assert.equal(item.objectKey, null);
  assert.deepEqual(item.documentMessage, {
    conversationId: id,
    messageId: pending.id,
  });
  const itemPath = catalog + '/' + item.id;
  assert.deepEqual(await h.call(root, 'GET', itemPath), item);
  const metadata = await h.call<CatalogItem>(ossOnly, 'GET', itemPath);
  assert.equal(metadata.documentMessage, null);
  assert.equal(metadata.previewable, false);
  await h.call(
    ossOnly,
    'GET',
    docRoute(pending, 'download'),
    undefined,
    403,
    'AUTH_FORBIDDEN',
  );
  await h.call(
    root,
    'DELETE',
    itemPath + '?version=1',
    undefined,
    404,
    'NOT_FOUND',
  );
  for (const kind of ['pdf', 'docx', 'doc'] as const) {
    const m = byName.get(kind)!,
      bytes = providerFiles.get(kind)!;
    assert.deepEqual(state(m), { state: 'available' });
    assert(typeof m.attachment?.fileName === 'string');
    assert.deepEqual(m.attachment?.document, {
      id: m.id,
      fileName: m.attachment.fileName,
      mimeType: DOC_MIME[kind],
      sizeBytes: bytes.length,
    });
    assert.deepEqual(
      privateFiles.get('private/dev/whatsapp/' + id + '/' + m.id + '.' + kind),
      bytes,
    );
    assert(!JSON.stringify(m).includes('https://'));
    const download = await fetch(h.url + docRoute(m, 'download'), {
      headers: { authorization: 'Bearer ' + manager.token },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('cache-control'), 'private, no-store');
    assert((await download.text()).includes('purpose=download'));
    for (const action of ['preview', 'download'] as const)
      await h.call(
        planner,
        'GET',
        docRoute(m, action),
        undefined,
        404,
        'NOT_FOUND',
      );
    const preview = await fetch(h.url + docRoute(m, 'preview'), {
      headers: { authorization: 'Bearer ' + manager.token },
    });
    if (kind === 'doc') {
      assert.equal(preview.status, 415);
      const error = (await preview.json()) as { code: string; message: string };
      assert.equal(error.code, 'WHATSAPP_DOCUMENT_PREVIEW_UNSUPPORTED');
      assert.equal(error.message, '该文件格式不支持预览，请下载后查看');
    } else {
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get('content-type'), DOC_MIME[kind]);
      const encoded = encodeURIComponent(m.attachment.fileName).replace(
        /['()*]/g,
        (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
      );
      assert.equal(
        preview.headers.get('content-disposition'),
        "inline; filename*=UTF-8''" + encoded,
      );
      assert.equal(preview.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(preview.headers.get('content-security-policy'), 'sandbox');
      assert.equal(preview.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
    }
  }
  const stored = await h.db.query<
    { attachment: unknown; seq: string; payload: { Message: unknown } }[]
  >(
    'SELECT m.attachment,m.seq,e.payload FROM whatsapp_messages m JOIN whatsapp_events e ON e.message_id=m.id WHERE m.id=$1',
    [pending.id],
  );
  assert.deepEqual(stored[0].attachment, raw);
  assert.deepEqual(stored[0].payload.Message, raw);
  assert.equal(stored[0].seq, pending.seq);
  for (const fault of ['unavailable', 'truncated'] as const) {
    storageFault = fault;
    await h.call(
      manager,
      'GET',
      docRoute(pending, 'preview'),
      undefined,
      409,
      'CONFLICT',
    );
  }
  storageFault = undefined;
  config.set('OSS_MEDIA_ENVIRONMENT', 'prod');
  assert.equal((await files('?kind=word')).total, 0);
  await h.call(root, 'GET', itemPath, undefined, 404, 'NOT_FOUND');
  assert.deepEqual(state((await list()).find((m) => m.id === pending.id)!), {
    state: 'pending',
  });
  await h.call(
    manager,
    'GET',
    docRoute(pending, 'download'),
    undefined,
    404,
    'NOT_FOUND',
  );
  config.set('OSS_MEDIA_ENVIRONMENT', 'dev');
  await h.db.query(
    "UPDATE whatsapp_conversations SET state='archived',archived_at=now() WHERE id=$1",
    [id],
  );
  const history = await fetch(h.url + docRoute(pending, 'preview'), {
    headers: { authorization: 'Bearer ' + manager.token },
  });
  assert.equal(history.status, 200);
  assert.deepEqual(Buffer.from(await history.arrayBuffer()), pdf);
  console.log(
    'WhatsApp document archives: migration and legacy rows, 3 formats, 5 states, retries, notifications, private links, HTTP preview and conversation/environment isolation passed.',
  );
}
void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    globalThis.fetch = originalFetch;
    await h.close();
  });
