import type { MailMessage } from './mail.types';
import { orderMailReadingHistory, StoredReadingMessage } from './mail-reading';
import { splitMailBody } from '../migrations/support/mail-quoted-body-v1';

const firstHeader = [
  '------------------------------------------------',
  '发件人：Guest <guest@example.test>',
  '发送时间：2026年11月6日(周五) 09:30',
  '收件人：Office<office@example.test>',
  '主　题：Trip',
].join('\n');
const officeHeader =
  'On 6 Nov 2026, at 15:06, Office <office@example.test> wrote:';
const guestText = 'Can we visit on Friday?';
const officeText = 'Yes, that works.';
const chain = [officeHeader, officeText, firstHeader, guestText].join('\n\n');

function message(
  id: string,
  email: string,
  body: string,
  occurredMinute: string,
  state: MailMessage['state'] = 'received',
): StoredReadingMessage {
  const { authoredBody, quotes } =
    state === 'sent' || state === 'received'
      ? splitMailBody(body)
      : { authoredBody: null, quotes: [] };
  return {
    id,
    threadId: 'thread',
    direction: state === 'received' ? 'inbound' : 'outbound',
    state,
    isRead: true,
    occurredAt: new Date(occurredMinute.replace(' ', 'T') + ':00+08:00'),
    occurredMinute,
    originalId: null,
    actorId: null,
    refs: [],
    internetId: id,
    sender: { email },
    recipients: [],
    replyTo: [],
    cc: [],
    subject: 'Trip',
    body,
    signature: null,
    attachments: [],
    version: 1,
    authoredBody,
    quotedHistory: quotes.map((q, i) => ({
      ...q,
      to: q.to ?? null,
      cc: q.cc ?? null,
      subject: q.subject ?? null,
      sourceMessageId: id,
      position: i + 1,
    })),
  };
}

describe('quoted email history', () => {
  it("splits alternating mail headers, keeping each turn's own text and attributed date", () => {
    const latest = 'Thanks!\nOn the way back, please stop for lunch.';
    const raw = [latest, chain].join('\n\n').replaceAll('\n', '\r\n');
    const result = splitMailBody(raw);
    expect(result.authoredBody).toBe(latest);
    expect(result.quotes).toMatchObject([
      {
        sender: 'Office <office@example.test>',
        sentAt: '2026-11-06 15:06',
        body: officeText,
      },
      {
        sender: 'Guest <guest@example.test>',
        sentAt: '2026-11-06 09:30',
        to: 'Office<office@example.test>',
        subject: 'Trip',
        body: guestText,
      },
    ]);
  });

  it('handles a wrapped attribution and nested quote marks', () => {
    const raw = [
      'Hello',
      'On Fri, Nov 6, 2026 at 3:06 PM',
      'Office <office@example.test> wrote:',
      '> Reply',
      '>',
      '> From: Guest <guest@example.test>',
      '> Date: 6 Nov 2026, 09:30',
      '> To: Office',
      '> Cc: Team',
      '> Subject: Trip',
      '>> First line',
      '>>',
      '>> Second line',
    ].join('\n');
    const result = splitMailBody(raw);
    expect(result.authoredBody).toBe('Hello');
    expect(result.quotes).toMatchObject([
      { sender: 'Office <office@example.test>', body: 'Reply' },
      { cc: 'Team', body: 'First line\n\nSecond line' },
    ]);
  });

  it('preserves incomplete headers, itinerary fields, ordinary prose and inline answers verbatim', () => {
    for (const raw of [
      'From: Airport\r\nTo: Hotel\r\nDate to confirm',
      '----\n发件人：旅客\nThank you.',
      'On arrival at 15:06 the guide wrote:\nWelcome',
      '   Normal mail\n',
      `Answer\n${officeHeader}\n> Question\nMy inline answer`,
    ]) {
      expect(splitMailBody(raw)).toEqual({ authoredBody: null, quotes: [] });
    }
  });

  it('presents quoted-only history oldest first and preserves the original message and its draft', () => {
    const raw = 'Latest reply\n\n' + chain;
    const source = message(
      'latest',
      'guest@example.test',
      raw,
      '2026-11-26 20:00',
    );
    const draft = message(
      'draft',
      'office@example.test',
      chain,
      '2026-11-27 09:00',
      'draft',
    );
    const [received, unsent] = orderMailReadingHistory([source, draft]);
    expect(received?.quotedHistory.map((quote) => quote.body)).toEqual([
      guestText,
      officeText,
    ]);
    expect(received?.quotedHistory.map((quote) => quote.sentAt)).toEqual([
      '2026-11-06 09:30',
      '2026-11-06 15:06',
    ]);
    expect(received).toMatchObject({ authoredBody: 'Latest reply', body: raw });
    expect(unsent).toMatchObject({
      id: draft.id,
      body: chain,
      quotedHistory: [],
      authoredBody: null,
    });
  });

  it.each([
    ['Fri, Nov 6, 2026 at 3:06 PM', '2026-11-06 15:06'],
    ['November 6, 2026 at 12:06 AM', '2026-11-06 00:06'],
    ['6 Nov 2026, at 12:06 PM', '2026-11-06 12:06'],
    ['06/11/2026 15:06', '06/11/2026 15:06'],
  ])(
    'displays the written time of %s without inferring a timezone or ambiguous date order',
    (input, expected) => {
      const raw = `Thanks\nOn ${input}, Office <office@example.test> wrote:\nHello`;
      const [entry] = orderMailReadingHistory([
        message('latest', 'guest@example.test', raw, '2026-11-26 20:00'),
      ]);
      expect(entry?.quotedHistory[0]?.sentAt).toBe(expected);
    },
  );

  it('anchors missing quotes before a matching original and suppresses repeated history without merging similar replies', () => {
    const genuine = message(
      'office',
      'office@example.test',
      officeText,
      '2026-11-06 15:06',
      'sent',
    );
    const second = message(
      'guest',
      'guest@example.test',
      'Thanks\n' + chain,
      '2026-11-15 08:00',
    );
    const third = message(
      'later',
      'guest@example.test',
      'Noted\n' +
        officeHeader.replace('15:06', '17:00') +
        '\n' +
        officeText +
        '\n' +
        chain,
      '2026-11-17 08:00',
    );
    const reading = orderMailReadingHistory([genuine, second, third]);
    expect(
      reading.map((entry) => entry.quotedHistory.map((q) => q.body)),
    ).toEqual([[guestText], [], [officeText]]);
    expect(reading[0]?.id).toBe(genuine.id);
    expect(reading[1]?.authoredBody).toBe('Thanks');
  });
});
