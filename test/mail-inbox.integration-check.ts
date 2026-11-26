import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { IsolationHarness } from './business-isolation.harness';
import { MailSync } from '../src/mail/mail.sync';
import {
  AliMailProvider,
  RemoteMail,
  OutgoingMail,
} from '../src/mail/alimail.provider';
import { MAILBOX, MailMessage, MailThread } from '../src/mail/mail.types';
import { MediaStorage } from '../src/media/media.storage';

async function main() {
  const h = new IsolationHarness(
    { OSS_MEDIA_ENVIRONMENT: 'dev' },
    { mail: true },
  );
  const countryId = randomUUID();
  try {
    await h.start({
      from: 1796256022000,
      seed: async () => {
        await h.db.query(
          `INSERT INTO system_business_dictionary_items(id,type_id,code,name,english_name) SELECT $1,id,'MAIL_TEST','测试地区','Test region' FROM system_business_dictionary_types WHERE code='country-region'`,
          [countryId],
        );
      },
    });
    assert.equal((await h.db.runMigrations()).length, 0);
    const mgr = await h.actor('website', 'BUSINESS_MANAGER');
    const alice = await h.actor('website'),
      bob = await h.actor('website');
    const other = await h.actor('linxi');
    await h.db.query("UPDATE users SET english_name='Alice' WHERE id=$1", [
      alice.id,
    ]);
    const remote = (
      id: string,
      refs: string[] = [],
      subject = 'Same subject',
    ): RemoteMail => ({
      providerId: id,
      internetId: id + '@example.test',
      refs,
      subject,
      sender: { email: 'client@example.test', name: 'Customer' },
      recipients: [{ email: MAILBOX }],
      cc: [],
      replyTo: [{ email: 'reply@example.test' }],
      body: 'Body ' + id,
      occurredAt: new Date('2026-11-26T01:02:00Z'),
      isRead: false,
      attachments: [],
    });
    const a = remote('first'),
      b = remote('second', [a.internetId!]),
      separate = remote('third');
    b.occurredAt = new Date('2026-11-26T02:03:00Z');
    b.attachments = [{ id: 'attachment', name: 'sample.pdf', size: 4 }];
    const sync = h.get(MailSync),
      provider = h.get(AliMailProvider),
      storage = h.get(MediaStorage);
    const messages = new Map([a, b, separate].map((m) => [m.providerId, m]));
    const objects = new Map<string, Buffer>();
    const uploads = new Map<string, Buffer>();
    const drafts: OutgoingMail[] = [];
    let sendCalls = 0,
      unknown = false;
    Object.defineProperties(provider, {
      enabled: { get: () => true },
      startAt: { get: () => '2026-11-26T00:00:00Z' },
    });
    let resume = false;
    provider.list = (folder, _start, _end, cursor) => {
      if (folder === '1')
        return Promise.resolve({ messages: [], hasMore: false });
      if (!cursor && !resume)
        return Promise.resolve({
          messages: [{ id: 'first' }],
          hasMore: true,
          nextCursor: 'next',
        });
      if (cursor) resume = true;
      return Promise.resolve({
        messages: [...messages.values()].map((m) => ({ id: m.providerId })),
        hasMore: false,
      });
    };
    provider.message = (id) => Promise.resolve(messages.get(id)!);
    provider.download = () => Promise.resolve(new Response('file'));
    provider.createReply = (input) => {
      drafts.push(input);
      return Promise.resolve({
        id: 'remote-' + drafts.length,
        internetId: 'draft-' + input.id + '@example.test',
      });
    };
    provider.upload = (_id, name, bytes) => {
      uploads.set(name, bytes);
      return Promise.resolve();
    };
    provider.send = () => {
      sendCalls++;
      return unknown
        ? Promise.reject(new Error('connection lost'))
        : Promise.resolve();
    };
    storage.putMail = async (key, obj, size) => {
      const chunks: Buffer[] = [];
      if (obj instanceof Readable)
        for await (const part of obj as AsyncIterable<Buffer>)
          chunks.push(part);
      else chunks.push(obj);
      const data = Buffer.concat(chunks);
      assert.equal(data.length, size);
      objects.set(key, data);
      return { etag: 'fixture' };
    };
    storage.signDocument = (key) => {
      assert.match(key, /^private\/dev\/email\//);
      return Promise.resolve({
        url:
          'data:application/octet-stream;base64,' +
          objects.get(key)!.toString('base64'),
      });
    };
    storage.remove = (keys) => {
      keys.forEach((k) => objects.delete(k));
      return Promise.resolve({ deleted: true });
    };
    await sync.poll();
    await sync.poll();
    await sync.poll();
    assert(resume);
    const list = await h.call<{ list: MailThread[]; total: number }>(
      mgr,
      'GET',
      '/mail/threads?view=unassigned',
    );
    assert.equal(list.total, 2);
    const unread = (who: typeof mgr) =>
      h.call<{ unreadCount: number }>(who, 'GET', '/mail/summary');
    assert.equal((await unread(mgr)).unreadCount, 3);
    assert.equal((await unread(alice)).unreadCount, 0);
    await h.call(
      other,
      'GET',
      '/mail/summary',
      undefined,
      403,
      'AUTH_FORBIDDEN',
    );
    // Sent Items can arrive before the inbox page that contains the original.
    const delayed = remote('late-original');
    await h.db.transaction((m) =>
      sync.ingest(
        m,
        {
          ...remote('external-sent', [delayed.internetId!]),
          sender: { email: MAILBOX },
        },
        false,
      ),
    );
    assert.equal(
      (await h.call<{ total: number }>(mgr, 'GET', '/mail/threads')).total,
      2,
    );
    await h.db.transaction((m) => sync.ingest(m, delayed, true));
    await h.db.transaction((m) =>
      sync.ingest(m, { ...delayed, providerId: 'duplicate-copy' }, true),
    );
    const [late] = await h.db.query<{ count: number }[]>(
      "SELECT count(*)::int AS count FROM mail_messages WHERE thread_id=(SELECT thread_id FROM mail_messages WHERE provider_id='late-original')",
    );
    assert.equal(late.count, 2);
    const [thread] = await h.db.query<{ id: string }[]>(
      "SELECT thread_id AS id FROM mail_messages WHERE provider_id='first'",
    );
    const path = '/mail/threads/' + thread.id;
    const detail = () =>
      h.call<MailThread & { messages: MailMessage[] }>(mgr, 'GET', path);
    const original = (await detail()).messages;
    assert.equal(original.length, 2);
    const source = original.find((msg) => msg.body === b.body)!;
    assert(source.attachments[0].available);
    assert.equal(
      (
        await h.call<{ url: string }>(
          mgr,
          'GET',
          path + '/attachments/' + source.attachments[0].id + '/download',
        )
      ).url.split(',')[1],
      Buffer.from('file').toString('base64'),
    );
    await h.call(bob, 'GET', path, undefined, 404, 'NOT_FOUND');
    await h.call(
      other,
      'GET',
      '/mail/threads',
      undefined,
      403,
      'AUTH_FORBIDDEN',
    );
    await h.call(
      mgr,
      'POST',
      path + '/assign',
      { ownerId: alice.id, version: 1 },
      201,
    );
    await h.call(
      bob,
      'GET',
      path + '/attachments/' + source.attachments[0].id + '/download',
      undefined,
      404,
      'NOT_FOUND',
    );
    assert.equal((await unread(alice)).unreadCount, 2);
    assert.equal((await unread(bob)).unreadCount, 0);
    await h.call(
      alice,
      'POST',
      path + '/read',
      { messageIds: original.map((message) => message.id) },
      201,
    );
    assert.equal((await detail()).unreadCount, 0);
    assert.equal((await unread(alice)).unreadCount, 0);
    assert.equal((await unread(mgr)).unreadCount, 2);
    const inboxSource = path + '/messages/' + source.id;
    const open = () =>
      h.call<MailMessage>(
        alice,
        'POST',
        inboxSource + '/reply',
        undefined,
        201,
      );
    const active = await Promise.all([open(), open()]);
    assert.equal(active[0].id, active[1].id);
    let draft = active[0];
    assert.equal(draft.recipients[0].email, 'reply@example.test');
    const draftPath = path + '/drafts/' + draft.id;
    const draftInput = {
      to: ['reply@example.test'],
      cc: ['copy@example.test'],
      subject: 'Re: Same subject',
      body: 'Quote ready',
      version: draft.version,
    };
    draft = await h.call<MailMessage>(alice, 'PUT', draftPath, draftInput);
    await h.call(alice, 'PUT', draftPath, draftInput, 409, 'CONFLICT');
    assert.equal((await open()).body, draftInput.body);
    const pdf = Buffer.from('%PDF-1.4\\nfixture\\n%%EOF');
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    const fixture = (name: string) =>
      readFileSync(resolve(__dirname, '../src/inquiries/fixtures', name));
    const doc = fixture('message.doc');
    const word = fixture('message.docx');
    const files: [string, Buffer][] = [
      ['image.png', png],
      ['quote.pdf', pdf],
      ['trip.doc', doc],
      ['trip.docx', word],
    ];
    const attach = async (name: string, bytes: Buffer) => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)]), name);
      return h.call<MailMessage>(
        alice,
        'POST',
        draftPath + '/attachments',
        form,
        201,
      );
    };
    draft = await attach('remove.pdf', pdf);
    draft = await h.call<MailMessage>(
      alice,
      'DELETE',
      draftPath + '/attachments/' + draft.attachments[0].id,
    );
    assert.equal(draft.attachments.length, 0);
    await sync.poll();
    for (const [name, bytes] of files) draft = await attach(name, bytes);
    assert.equal(draft.attachments.length, 4);
    await Promise.all(
      [1, 2].map(() =>
        h.call(
          alice,
          'POST',
          draftPath + '/send',
          { version: draft.version },
          201,
        ),
      ),
    );
    assert.equal(sendCalls, 1);
    assert.equal(drafts[0].name, 'Alice');
    assert.equal(drafts[0].parent, b.internetId);
    assert.equal(drafts[0].cc[0].email, 'copy@example.test');
    for (const [name, bytes] of files)
      assert.deepEqual(uploads.get(name), bytes);
    assert(
      (await detail()).messages
        .find((m) => m.id === draft.id)
        ?.signature?.includes('Alice\nTravel Consultant'),
    );
    // Reconcile a rewritten provider Message-ID without creating a duplicate local reply.
    const sent = {
      ...remote('server-sent', [a.internetId!, b.internetId!]),
      sender: { email: MAILBOX },
      marker: draft.id,
    };
    await h.db.transaction((m) => sync.ingest(m, sent, false));
    await h.db.transaction((m) =>
      sync.ingest(m, remote('follow-up', [sent.internetId!]), true),
    );
    assert.equal((await detail()).messages.length, 4);
    const inquiryInput = {
      countryItemId: countryId,
      customerName: 'Customer',
      plannedDays: 3,
      requirements: b.body,
      contactChannel: 'Website',
      contactInfo: 'forged',
      acquisitionSource: 'forged',
      version: (await detail()).version,
    };
    const inquiries = await Promise.all(
      [1, 2].map(() =>
        h.call<{ inquiryId: string; created: boolean }>(
          alice,
          'POST',
          inboxSource + '/inquiry',
          inquiryInput,
          201,
        ),
      ),
    );
    assert.equal(inquiries[0].inquiryId, inquiries[1].inquiryId);
    assert.equal(inquiries.filter((i) => i.created).length, 1);
    const inquiryPath = '/website/inquiries/' + inquiries[0].inquiryId;
    const inquiry = await h.call<{
      ownerId: string;
      receivedAt: string;
      contactChannel: string;
      contactInfo: string;
      acquisitionSource: string;
      mailSource: { messageId: string };
      version: number;
    }>(alice, 'GET', inquiryPath);
    assert.equal(inquiry.ownerId, alice.id);
    assert.equal(inquiry.receivedAt, '2026-11-26 10:03');
    assert.equal(inquiry.contactInfo, 'reply@example.test');
    assert.equal(inquiry.contactChannel, 'Email');
    assert.equal(inquiry.acquisitionSource, '');
    assert.equal(inquiry.mailSource.messageId, source.id);
    const retry = await open();
    const retryPath = path + '/drafts/' + retry.id;
    const saved = await h.call<MailMessage>(alice, 'PUT', retryPath, {
      ...draftInput,
      version: retry.version,
    });
    unknown = true;
    const uncertain = await h.call<MailMessage>(
      alice,
      'POST',
      retryPath + '/send',
      { version: saved.version },
      201,
    );
    assert.equal(uncertain.state, 'unknown');
    await h.call(
      alice,
      'POST',
      retryPath + '/send',
      { version: uncertain.version },
      201,
    );
    assert.equal(sendCalls, 2);
    await h.call(
      mgr,
      'POST',
      path + '/assign',
      { ownerId: bob.id, version: (await detail()).version },
      409,
      'CONFLICT',
    );
    await h.db.transaction((m) =>
      sync.ingest(
        m,
        {
          ...sent,
          providerId: 'confirmed',
          internetId: 'confirmed@example.test',
          marker: saved.id,
        },
        false,
      ),
    );
    await h.call(
      mgr,
      'POST',
      inquiryPath + '/transfer',
      { version: inquiry.version, ownerId: bob.id, reason: 'transfer' },
      201,
    );
    assert.equal((await detail()).ownerId, bob.id);
    await h.call(alice, 'GET', path, undefined, 404, 'NOT_FOUND');
    const ledger = await h.call<{ id: string }>(
      bob,
      'POST',
      '/ledgers/direct',
      {
        websiteInquiryId: inquiries[0].inquiryId,
        receivedDate: '2026-11-26',
        source: 'Synthetic',
        operatorId: bob.id,
        itinerary: 'Synthetic title',
      },
      201,
    );
    await h.db.query('DELETE FROM direct_ledgers WHERE id=$1', [ledger.id]);
    await h.call(
      mgr,
      'POST',
      path + '/assign',
      { ownerId: alice.id, version: (await detail()).version },
      409,
      'CONFLICT',
    );
    console.log(
      'Mail inbox isolated PostgreSQL upgrade, sync, role scope, MIME attachments, draft concurrency, reply reconciliation, selected source, inquiry transfer and permanent ledger lock passed.',
      h.requests,
      'HTTP checks.',
    );
  } finally {
    await h.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
