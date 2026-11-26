import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FeishuSendException, FeishuService } from '../feishu/feishu.service';
import { formatNotificationDigest } from '../feishu/notification-digest';
import { digestParts, DigestItem } from './notification-digest-items';

type Outcome = 'sent' | 'skipped' | 'failed' | 'unknown';
type Family = 'whatsapp' | 'ledger' | 'inquiry';
const tables: Record<Family, string> = {
  whatsapp: 'whatsapp_notification_deliveries',
  ledger: 'feishu_ledger_notifications',
  inquiry: 'inquiry_follow_up_reminders',
};
const families: Family[] = ['whatsapp', 'ledger', 'inquiry'];
function family(item: DigestItem): Family {
  if (item.type.startsWith('whatsapp_')) return 'whatsapp';
  return item.type === 'inquiry_follow_up' ? 'inquiry' : 'ledger';
}
function sourceOutcome(kind: Family, outcome: Outcome) {
  if (kind === 'inquiry' && outcome === 'skipped') return 'cancelled';
  if (kind !== 'whatsapp' && outcome === 'unknown') return 'failed';
  return outcome;
}
interface Claim {
  id: string;
  open_id: string;
  attempts: number;
}

@Injectable()
export class NotificationDigestsService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly logger = new Logger(NotificationDigestsService.name);
  constructor(
    private readonly db: DataSource,
    private readonly feishu: FeishuService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      this.running ??= this.drain()
        .catch(() => this.logger.error('Feishu digest worker failed'))
        .finally(() => {
          this.running = undefined;
        });
    }, 1000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }

  private async finish(
    manager: EntityManager,
    id: string,
    outcome: Outcome,
    messageId: string | null = null,
  ) {
    for (const kind of families) {
      const delivery =
        kind === 'ledger'
          ? ''
          : ",sent_at=CASE WHEN $2='sent' THEN clock_timestamp() ELSE sent_at END";
      const reason =
        kind === 'ledger'
          ? ''
          : ",error_code=CASE WHEN $4 THEN 'DELIVERY_OUTCOME_UNKNOWN' WHEN $2='failed' THEN 'FEISHU_SEND_FAILED' ELSE NULL END";
      const unknown =
        kind === 'inquiry'
          ? ',delivery_unknown=$4,updated_at=clock_timestamp()'
          : '';
      const args: (string | boolean | null)[] = [
        id,
        sourceOutcome(kind, outcome),
        messageId,
      ];
      if (kind !== 'ledger') args.push(outcome === 'unknown');
      await manager.query(
        `UPDATE ${tables[kind]} SET status=$2,message_id=$3${delivery}${reason}${unknown}
        WHERE digest_id=$1 AND status='pending'`,
        args,
      );
    }
    await manager.query(
      'UPDATE feishu_notification_digests SET status=$2,message_id=$3 WHERE id=$1',
      [id, outcome, messageId],
    );
  }

  private async updateItems(
    manager: EntityManager,
    items: DigestItem[],
    action: 'skip' | 'defer' | 'claim',
    value?: Date | string,
  ) {
    for (const kind of families) {
      const ids = items.filter((i) => family(i) === kind).map((i) => i.id);
      if (!ids.length) continue;
      let change = 'status=$2';
      if (action === 'defer') change = 'digest_at=$2,digest_id=NULL';
      if (action === 'claim')
        change =
          'digest_id=$2' +
          (kind === 'inquiry'
            ? ',recipient_id=(SELECT owner_id FROM inquiries WHERE id=inquiry_id)'
            : '');
      await manager.query(
        `UPDATE ${tables[kind]} SET ${change} WHERE id=ANY($1::uuid[]) AND status='pending'`,
        [ids, value ?? sourceOutcome(kind, 'skipped')],
      );
    }
  }

  private async claim(manager: EntityManager) {
    const [lock] = await manager.query<{ ok: boolean }[]>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended('feishu-notification-digest-dispatch',0)) AS ok",
    );
    if (!lock.ok) return;
    const abandoned = await manager.query<{ id: string }[]>(
      "SELECT id FROM feishu_notification_digests WHERE status='sending' AND claimed_at<clock_timestamp()-interval '2 minutes'",
    );
    for (const row of abandoned) await this.finish(manager, row.id, 'unknown');
    // This limit is shared by API instances; no connection or business lock waits for the next slot.
    const [seed] = await manager.query<
      { open_id: string; digest_at: Date; digest_id: string | null }[]
    >(
      `SELECT p.open_id,p.digest_at,p.digest_id FROM feishu_pending_digest_items p
       LEFT JOIN feishu_notification_digests r ON r.id=p.digest_id
       WHERE p.digest_at<=now() AND (p.digest_id IS NULL OR (r.status='retry' AND r.retry_at<=now()))
       AND NOT EXISTS (SELECT 1 FROM feishu_notification_digests WHERE claimed_at>clock_timestamp()-interval '1 second')
       ORDER BY p.digest_at LIMIT 1`,
    );
    if (!seed) return;
    // A writer that already chose a quiet window must commit before we close that window's digest.
    // Skip a busy opening and try on the next tick. No lock is held during the network call.
    const [barrier] = await manager.query<{ ready: boolean }[]>(
      `WITH wanted AS MATERIALIZED (SELECT type FROM feishu_notification_settings WHERE window_start IS NOT NULL OR
         type IN (SELECT type FROM feishu_pending_digest_items WHERE open_id=$1 AND digest_at<=now())),
       locked AS (SELECT s.type FROM feishu_notification_settings s JOIN wanted w USING(type) ORDER BY s.type FOR UPDATE OF s SKIP LOCKED)
       SELECT (SELECT count(*) FROM wanted)=(SELECT count(*) FROM locked) AS ready`,
      [seed.open_id],
    );
    if (!barrier.ready) return;
    const items = await manager.query<DigestItem[]>(
      `SELECT p.*,
      s.enabled AND (s.last_disabled_at IS NULL OR s.last_disabled_at<p.created_at) AS enabled,
      feishu_window_resume(s.window_start,s.window_end,clock_timestamp()) AS resume
      FROM feishu_pending_digest_items p JOIN feishu_notification_settings s ON s.type=p.type
      WHERE p.open_id=$1 AND p.digest_at<=now() AND p.digest_id IS NOT DISTINCT FROM $2::uuid`,
      [seed.open_id, seed.digest_id],
    );
    for (const kind of families) {
      const ids = items.filter((i) => family(i) === kind).map((i) => i.id);
      if (ids.length)
        await manager.query(
          `SELECT id FROM ${tables[kind]} WHERE id=ANY($1::uuid[]) AND status='pending' ORDER BY id FOR UPDATE`,
          [ids],
        );
    }
    let due = items.filter((i) => i.enabled && !i.resume);
    const deferred = new Map<number, DigestItem[]>();
    for (const item of items)
      if (item.enabled && item.resume) {
        const key = item.resume.getTime();
        const group = deferred.get(key);
        if (group) group.push(item);
        else deferred.set(key, [item]);
      }
    for (const [timestamp, rows] of deferred)
      await this.updateItems(manager, rows, 'defer', new Date(timestamp));
    let parts = this.feishu.configured
      ? await digestParts(manager, seed.open_id, due)
      : [];
    const valid = new Set(parts.map((p) => p.id));
    await this.updateItems(
      manager,
      items.filter((i) => !i.enabled || (!i.resume && !valid.has(i.id))),
      'skip',
    );
    if (!parts.length) {
      if (seed.digest_id)
        await manager.query(
          `UPDATE feishu_notification_digests SET status='skipped' WHERE id=$1
        AND status='retry' AND NOT EXISTS(SELECT 1 FROM feishu_pending_digest_items WHERE digest_id=$1)`,
          [seed.digest_id],
        );
      return;
    }

    // Counting many conversations can span the closing minute. Recheck before committing the send intent.
    const gates = await manager.query<
      { type: DigestItem['type']; resume: Date }[]
    >(
      `SELECT type,resume FROM
      (SELECT type,feishu_window_resume(window_start,window_end,clock_timestamp()) AS resume FROM feishu_notification_settings
       WHERE type=ANY($1::text[])) current_window WHERE resume IS NOT NULL`,
      [[...new Set(parts.map((p) => p.type))]],
    );
    for (const gate of gates) {
      await this.updateItems(
        manager,
        due.filter((i) => i.type === gate.type && valid.has(i.id)),
        'defer',
        gate.resume,
      );
      due = due.filter((i) => i.type !== gate.type);
      parts = parts.filter((p) => p.type !== gate.type);
    }
    if (!parts.length) return;
    let job: Claim | undefined;
    if (seed.digest_id) {
      const [rows] = await manager.query<[Claim[], number]>(
        `UPDATE feishu_notification_digests SET status='sending',claimed_at=clock_timestamp(),attempts=attempts+1
         WHERE id=$1 AND open_id=$2 AND status='retry' RETURNING id,open_id,attempts`,
        [seed.digest_id, seed.open_id],
      );
      job = rows[0];
      if (!job) {
        await this.updateItems(
          manager,
          due.filter((i) => valid.has(i.id)),
          'defer',
          seed.digest_at,
        );
        return;
      }
    } else {
      const slot = due
        .filter((i) => valid.has(i.id))
        .reduce(
          (first, i) => (i.digest_at < first ? i.digest_at : first),
          due.find((i) => valid.has(i.id))!.digest_at,
        );
      [job] = await manager.query<Claim[]>(
        `INSERT INTO feishu_notification_digests(open_id,slot,status) VALUES($1,$2,'sending')
         ON CONFLICT(open_id,slot) DO NOTHING RETURNING id,open_id,attempts`,
        [seed.open_id, slot],
      );
      if (!job) {
        // A transaction committed a late member of an already claimed opening. Never send a second summary.
        await this.updateItems(
          manager,
          due.filter((i) => i.digest_at.getTime() === slot.getTime()),
          'skip',
        );
        return;
      }
    }
    await this.updateItems(
      manager,
      due.filter((i) => valid.has(i.id)),
      'claim',
      job.id,
    );
    return { job, parts };
  }

  async drain() {
    const claim = await this.db.transaction((manager) => this.claim(manager));
    if (!claim) return;
    const { job, parts } = claim;
    const onlyMessages = parts.every((p) => p.type === 'whatsapp_message');
    const text = formatNotificationDigest(
      parts,
      this.feishu.summaryUrl(onlyMessages),
    );
    let messageId: string;
    try {
      ({ messageId } = await this.feishu.sendText(job.open_id, text, job.id));
    } catch (error) {
      const rejected =
        error instanceof FeishuSendException && !error.deliveryUnknown;
      if (rejected && job.attempts < 4) {
        await this.db.query(
          `UPDATE feishu_notification_digests SET status='retry',retry_at=clock_timestamp()+($2::int*interval '1 second') WHERE id=$1 AND status='sending'`,
          [job.id, [30, 120, 480][job.attempts - 1]],
        );
      } else
        await this.db.transaction((manager) =>
          this.finish(manager, job.id, rejected ? 'failed' : 'unknown'),
        );
      return;
    }
    await this.db.transaction((manager) =>
      this.finish(manager, job.id, 'sent', messageId),
    );
  }
}
