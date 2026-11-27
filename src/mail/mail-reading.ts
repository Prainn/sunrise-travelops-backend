import type { MailReadingMessage } from './mail.types';

export type StoredReadingMessage = MailReadingMessage & {
  occurredMinute: string;
};

function matchKey(sender: string, sentAt: string, body: string) {
  const email = /<([^<>\s]+@[^<>\s]+)>/.exec(sender)?.[1] ?? sender;
  return JSON.stringify([
    email.trim().toLowerCase(),
    sentAt,
    body.replace(/\s+/g, ' ').trim(),
  ]);
}

export function orderMailReadingHistory(
  rows: StoredReadingMessage[],
): MailReadingMessage[] {
  const originals = new Map<string, MailReadingMessage>();
  const messages = rows.map(({ occurredMinute, ...row }) => {
    const message: MailReadingMessage = { ...row, quotedHistory: [] };
    if (row.state === 'received' || row.state === 'sent') {
      const body = row.authoredBody ?? row.body;
      originals.set(matchKey(row.sender.email, occurredMinute, body), message);
      if (row.signature)
        originals.set(
          matchKey(
            row.sender.email,
            occurredMinute,
            body + '\n' + row.signature,
          ),
          message,
        );
    }
    return message;
  });

  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    // Walk the source newest first. A matching delivered message anchors the older turns.
    let anchor = messages[index];
    for (const quote of row.quotedHistory) {
      const key = matchKey(quote.sender, quote.sentAt, quote.body);
      const original = originals.get(key);
      if (original) anchor = original;
      else if (!seen.has(key)) {
        anchor.quotedHistory.push(quote);
        seen.add(key);
      }
    }
  }
  for (const message of messages) message.quotedHistory.reverse();
  return messages;
}
