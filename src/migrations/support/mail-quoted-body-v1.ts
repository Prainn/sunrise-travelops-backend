import type { EntityManager } from 'typeorm';

// Frozen conversion for StoreMailQuotedHistory1796256025000. New formats require a new revision.
interface QuoteHeader {
  sender: string;
  sentAt: string;
  to?: string;
  cc?: string;
  subject?: string;
}

export interface QuotedMail extends QuoteHeader {
  body: string;
}

const HEADER_FIELD =
  /^(From|发件人|Sent|Date|发送时间|日期|To|收件人|Cc|抄送|Subject|主\s*题)\s*[:：]\s*(.+)$/i;
const WROTE_HEADER =
  /^On\s+(.+?\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?),?\s+(.+?)\s+wrote\s*[:：]$/i;
const HEADER_DIVIDER =
  /^(?:[-_]{4,}|-{2,}\s*(?:Original Message|Forwarded message|原始邮件)\s*-{2,})$/i;
const QUOTE_PREFIX = /^(?:[ \t]*>[ \t]?)+/;

function headerText(line: string) {
  return line.replace(QUOTE_PREFIX, '').trim();
}

function readQuoteHeader(lines: string[], start: number) {
  const first = headerText(lines[start]);
  if (/^On\s/i.test(first)) {
    let text = first;
    // Mail clients sometimes wrap the attribution before the sender's address.
    for (let end = start + 1; end <= start + 3; end++) {
      const wrote = WROTE_HEADER.exec(text);
      if (wrote && /\b\d{4}\b/.test(wrote[1]))
        return { header: { sentAt: wrote[1], sender: wrote[2] }, end };
      const next = headerText(lines[end] ?? '');
      if (!next || /^On\s/i.test(next) || text.length > 500) break;
      text += ' ' + next;
    }
    return;
  }
  if (!/^(?:From|发件人)\s*[:：]/i.test(first)) return;
  const header: QuoteHeader = { sender: '', sentAt: '' };
  let end = start;
  for (; end < lines.length; end++) {
    const field = HEADER_FIELD.exec(headerText(lines[end]));
    if (!field) break;
    const key = field[1].toLowerCase();
    const value = field[2];
    if (key === 'from' || key === '发件人') {
      if (end !== start) break;
      header.sender = value;
    } else if (['sent', 'date', '发送时间', '日期'].includes(key))
      header.sentAt = value;
    else if (key === 'to' || key === '收件人') header.to = value;
    else if (key === 'cc' || key === '抄送') header.cc = value;
    else header.subject = value;
  }
  if (
    header.sender &&
    /\d/.test(header.sentAt) &&
    (header.to || header.subject)
  )
    return { header, end };
}

/**
 * Read recognized reply attributions from a copy of the body. Preserve the
 * source text when quote levels and inline replies cannot be separated safely.
 */
export function splitMailBody(raw: string) {
  const lines = raw.split(/\r\n?|\n/);
  const quotes: QuotedMail[] = [];
  let authoredBody: string | null = null;
  let start = 0;
  let previous: QuoteHeader | undefined;
  function finish(end: number) {
    const content = lines.slice(start, end);
    if (previous) {
      const nonblank = content.filter((line) => headerText(line));
      const prefixed = nonblank.filter((line) => QUOTE_PREFIX.test(line));
      if (prefixed.length && prefixed.length !== nonblank.length) return false;
      const body = content
        .map((line) => line.replace(QUOTE_PREFIX, ''))
        .join('\n')
        .trim();
      quotes.push({
        ...previous,
        sentAt: formatQuotedDateTime(previous.sentAt),
        body,
      });
    } else {
      authoredBody = content.join('\n').trim();
    }
    return true;
  }
  for (let i = 0; i < lines.length; i++) {
    const boundary = readQuoteHeader(lines, i);
    if (!boundary) continue;
    const hasDivider =
      i > start && HEADER_DIVIDER.test(headerText(lines[i - 1]));
    if (!finish(hasDivider ? i - 1 : i))
      return { authoredBody: null, quotes: [] };
    previous = boundary.header;
    start = boundary.end;
    i = start - 1;
  }
  if (previous && !finish(lines.length))
    return { authoredBody: null, quotes: [] };
  return { authoredBody, quotes };
}

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

// Quoted headers can omit their timezone. Format the written clock time without shifting it.
function formatQuotedDateTime(sentAt: string) {
  const chinese =
    /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:[（(][^）)]*[）)])?\s+(\d{1,2}):(\d{2})$/.exec(
      sentAt,
    );
  if (chinese) {
    const [, year, month, day, hour, minute] = chinese;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${minute}`;
  }
  const english =
    /^(?:[a-z]+,\s*)?(\d{1,2}\s+[a-z]+|[a-z]+\s+\d{1,2}),?\s+(\d{4}),?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([ap]m))?$/i.exec(
      sentAt,
    );
  if (english) {
    const [, dayMonth, year, hour, minute, period] = english;
    const parts = dayMonth.toLowerCase().split(/\s+/);
    const [day, monthName] = /^\d/.test(parts[0])
      ? parts
      : [parts[1], parts[0]];
    const month = MONTHS.indexOf(monthName.slice(0, 3)) + 1;
    let hours = Number(hour);
    if (
      !month ||
      Number(day) < 1 ||
      Number(day) > 31 ||
      Number(minute) > 59 ||
      hours > 23
    )
      return sentAt;
    if (period) {
      if (hours < 1 || hours > 12) return sentAt;
      hours = (hours % 12) + (period.toLowerCase() === 'pm' ? 12 : 0);
    }
    return `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')} ${String(hours).padStart(2, '0')}:${minute}`;
  }
  return sentAt;
}

export async function insertMailQuotes(
  manager: EntityManager,
  messageId: string,
  quotes: QuotedMail[],
) {
  if (!quotes.length) return;
  await manager.query(
    `INSERT INTO mail_message_quotes(message_id, position, sender, sent_at_text, recipient_text, cc_text, subject, body)
     SELECT $1, pos::integer, q->>'sender', q->>'sentAt', q->>'to', q->>'cc', q->>'subject', q->>'body'
     FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS parts(q, pos)`,
    [messageId, JSON.stringify(quotes)],
  );
}
