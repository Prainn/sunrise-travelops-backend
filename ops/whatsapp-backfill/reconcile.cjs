'use strict';

const { createHash } = require('node:crypto');

const PAGE_SIZE = 100;
const OVERLAP = 10 * 60_000;
const WINDOW = 6 * 60 * 60_000;

function messageTime(value) {
  if (typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/i.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function plainText(row) {
  if (row.messageType?.toUpperCase() !== 'TEXT' || row.type?.toLowerCase() !== 'message' ||
      row.context || row.contextMessageId || typeof row.message !== 'string') return null;
  let text = row.message;
  if (text.trimStart().startsWith('{')) {
    let content;
    try { content = JSON.parse(text); } catch { return null; }
    if (Object.keys(content).length !== 1 || typeof content.text !== 'string') return null;
    text = content.text;
  }
  return text.trim() && !text.includes('\0') && text.isWellFormed() && text.length <= 200000 ? text : null;
}

function candidate(row, account, from, until) {
  if (row.businessNumber !== account.phone || row.channelType !== 'WHATSAPP' || row.eventAction !== 'UP')
    throw new Error('PROVIDER_ACCOUNT_OR_DIRECTION_MISMATCH');
  const id = typeof row.messageId === 'string' && row.messageId.trim() &&
    row.messageId.length <= 1000 && row.messageId.isWellFormed() && !row.messageId.includes('\0') ? row.messageId : null;
  const time = messageTime(row.sendTime);
  const item = { id, time, type: row.messageType };
  if (!id || time === null) return { ...item, reason: 'MISSING_ID_OR_TIME' };
  // A response outside the requested period cannot be silently counted as coverage.
  if (time < from || time > until) throw new Error('PROVIDER_WINDOW_MISMATCH');
  const sender = typeof row.userNumber === 'string' ? row.userNumber.replace(/^\+/, '') : '';
  if (!/^(?:\d{5,20}|[A-Z]{2}\.[A-Za-z0-9.]{1,120})$/.test(sender))
    return { ...item, reason: 'MISSING_SENDER' };
  const text = plainText(row);
  if (text === null) return { ...item, reason: 'NEEDS_ORIGINAL_CONTENT' };
  return { ...item, payload: {
    CustSpaceId: account.spaceId, WabaId: account.wabaId, To: account.phone,
    From: sender, MessageId: id, NoticeType: 'inbound', Type: 'text', Message: text,
    Timestamp: time, record: { UniqueMessageId: /^wamid\.[A-Za-z0-9+/=_-]{1,990}$/.test(row.uniqueMessageId ?? '') ?
      row.uniqueMessageId : undefined },
  } };
}

async function review(db, accountId, releaseKey, key, item, from, until) {
  await db.query(`INSERT INTO whatsapp_backfill_reviews
    (account_id,release_key,item_key,provider_id,occurred_at,reason,message_type,window_start,window_end)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
  [accountId, releaseKey, key, item.id, item.time == null ? null : new Date(item.time),
    item.reason, item.type, new Date(from), new Date(until)]);
}

async function ingestPage(db, account, releaseKey, rows, from, until) {
  const items = rows.map(row => candidate(row, account, from, until));
  const ids = items.map(item => item.id).filter(Boolean);
  const messages = await db.query(`SELECT provider_id FROM whatsapp_messages
    WHERE account_id=$1 AND provider_id=ANY($2::text[])`, [account.id, ids]);
  const known = new Set(messages.rows.map(row => row.provider_id));
  const events = await db.query(`SELECT payload->>'MessageId' AS id, bool_and(state='failed') AS failed
    FROM whatsapp_events WHERE account_id=$1 AND kind='inbound' AND payload->>'MessageId'=ANY($2::text[])
    GROUP BY payload->>'MessageId'`, [account.id, ids]);
  const received = new Map(events.rows.map(row => [row.id, row.failed]));
  let queued = 0;
  for (const [i, item] of items.entries()) {
    if (known.has(item.id) || received.get(item.id) === false) continue;
    if (received.get(item.id)) item.reason = 'ORIGINAL_EVENT_FAILED';
    if (item.reason) {
      // With no provider ID, keep overlapping scans of the same incomplete row identifiable.
      const key = item.id ? 'message:' + item.id :
        'incomplete:' + createHash('sha256').update(JSON.stringify(rows[i])).digest('hex');
      await review(db, account.id, releaseKey, key, item, from, until);
      continue;
    }
    const result = await db.query(`INSERT INTO whatsapp_events(account_id,event_key,payload,kind)
      VALUES ($1,$2,$3,'inbound') ON CONFLICT (account_id,event_key) DO NOTHING`,
    [account.id, 'release-backfill:' + item.id, { ...item.payload, BackfillRelease: releaseKey }]);
    queued += result.rowCount;
    known.add(item.id);
  }
  return queued;
}

async function transaction(db, work) {
  await db.query('BEGIN');
  try {
    const result = await work();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function scanPages(db, account, key, from, until, recipient, listPage) {
  let scanned = 0, queued = 0;
  const fullPages = new Set();
  for (let page = 1; ; page++) {
    const rows = await listPage(account, from, until, page, PAGE_SIZE, recipient);
    if (!Array.isArray(rows) || rows.length > PAGE_SIZE) throw new Error('INVALID_PROVIDER_PAGE');
    if (recipient && rows.some(row => typeof row.userNumber !== 'string' ||
        !account.recipients.includes(row.userNumber.replace(/^\+/, '')))) throw new Error('DEV_TEST_CONTACT_MISMATCH');
    if (rows.length === PAGE_SIZE) {
      const marker = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
      if (fullPages.has(marker)) throw new Error('REPEATED_PROVIDER_PAGE');
      fullPages.add(marker);
    }
    queued += await ingestPage(db, account, key, rows, from, until);
    scanned += rows.length;
    if (rows.length < PAGE_SIZE) return { scanned, queued };
  }
}

async function scan(db, account, run, listPage, now) {
  const end = run.until_at.getTime();
  const key = run.release_key;
  let next = run.next_at?.getTime();
  if (next == null) {
    const previous = await db.query(`SELECT max(until_at) AS last FROM whatsapp_backfill_runs
      WHERE account_id=$1 AND finished_at IS NOT NULL AND until_at<=$2`, [account.id, run.until_at]);
    next = Math.min(run.started_at.getTime(), previous.rows[0].last?.getTime() ?? Infinity) - OVERLAP;
  }
  // CAMS only exposes recent history. Keep any inaccessible interval visible for manual review.
  const oldest = now - 30 * 86400000 + 60_000;
  if (next <= end && next < oldest) {
    const last = Math.min(end, oldest - 1);
    await transaction(db, async () => {
      await review(db, account.id, key, 'older:' + next + '-' + last, { reason: 'HISTORY_RANGE_REVIEW' }, next, last);
      await db.query('UPDATE whatsapp_backfill_runs SET next_at=$3 WHERE account_id=$1 AND release_key=$2',
        [account.id, key, new Date(last + 1)]);
    });
    next = last + 1;
  }
  while (next <= end) {
    const until = Math.min(next + WINDOW - 1, end);
    // A failed page replays this whole slice. No partial coverage or counts are committed.
    await transaction(db, async () => {
      let scanned = 0, queued = 0;
      for (const recipient of account.recipients ?? [undefined]) {
        const counts = await scanPages(db, account, key, next, until, recipient, listPage);
        queued += counts.queued;
        scanned += counts.scanned;
      }
      await db.query(`UPDATE whatsapp_backfill_runs SET next_at=$3,scanned=scanned+$4,queued=queued+$5
        WHERE account_id=$1 AND release_key=$2`, [account.id, key, new Date(until + 1), scanned, queued]);
    });
    next = until + 1;
  }
  await db.query('UPDATE whatsapp_backfill_runs SET finished_at=now() WHERE account_id=$1 AND release_key=$2',
    [account.id, key]);
}

async function receipt(db, accountId, key) {
  const result = await db.query(`SELECT r.release_key AS release,r.scanned,r.queued,r.finished_at IS NOT NULL AS scanned_all,
    counts.recovered,counts.pending,counts.failed,
    (SELECT count(*)::int FROM whatsapp_backfill_reviews v WHERE v.account_id=r.account_id AND v.release_key=r.release_key
       AND NOT EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.account_id=v.account_id AND m.provider_id=v.provider_id)) AS review
    FROM whatsapp_backfill_runs r CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE e.state='done' AND e.message_id IS NOT NULL)::int AS recovered,
             count(*) FILTER (WHERE e.state='pending')::int AS pending,
             count(*) FILTER (WHERE e.state='failed')::int AS failed
      FROM whatsapp_events e WHERE e.account_id=r.account_id AND e.kind='inbound'
        AND e.event_key LIKE 'release-backfill:%' AND e.payload->>'BackfillRelease'=r.release_key
    ) counts WHERE r.account_id=$1 AND r.release_key=$2`, [accountId, key]);
  return result.rows[0];
}

async function reconcile(db, account, key, window, listPage, now = Date.now()) {
  // A dedicated connection owns this lock. Normal callbacks and the inbox worker use different locks.
  await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))', ['whatsapp-backfill:' + account.id]);
  try {
    if (window) await db.query(`INSERT INTO whatsapp_backfill_runs(account_id,release_key,started_at,until_at)
      VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [account.id, key, new Date(window.start), new Date(window.end)]);
    if (!window && !(await receipt(db, account.id, key))) throw new Error('UNKNOWN_RELEASE');
    const pending = await db.query(`SELECT release_key,started_at,until_at,next_at FROM whatsapp_backfill_runs
      WHERE account_id=$1 AND finished_at IS NULL ORDER BY until_at,release_key`, [account.id]);
    const completed = [];
    for (const run of pending.rows) {
      await scan(db, account, run, listPage, now);
      if (run.release_key !== key) completed.push(await receipt(db, account.id, run.release_key));
    }
    completed.push(await receipt(db, account.id, key));
    return completed;
  } finally {
    await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', ['whatsapp-backfill:' + account.id]);
  }
}

module.exports = { reconcile };
