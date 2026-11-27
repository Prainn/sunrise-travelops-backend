import { EntityManager } from 'typeorm';
import type { LoginScope } from '../users/user-identity.entity';
import { eligibleWhatsappRecipient } from '../whatsapp/whatsapp-notifications';
import { unreadWhatsappMessageSql } from '../whatsapp/whatsapp-unread';
import {
  eligibleLedgerRecipient,
  LedgerReminderRow,
  reminderKind,
} from '../ledgers/ledger-notifications.service';
import { NotificationType } from './notification-settings';
import {
  eligibleWebsiteNotificationRecipient,
  NotificationRecipient,
} from './website-notification-recipients';

export interface DigestItem {
  id: string;
  type: NotificationType;
  subject_id: string;
  occurred_at: Date;
  digest_at: Date;
  digest_id: string | null;
  enabled: boolean;
  resume: Date | null;
}

export interface DigestPart {
  id: string;
  type: NotificationType;
  subject: string;
  count: number;
  oldest: Date;
}

interface Identity extends NotificationRecipient {
  scope: LoginScope;
  superuser: boolean;
}

// Reuse the individual senders' recipient rules. Resolve all objects for one Open ID in batches.
export async function digestParts(
  manager: EntityManager,
  openId: string,
  items: DigestItem[],
) {
  const parts: DigestPart[] = [];
  if (!openId || !items.length) return parts;
  const identities = await manager.query<Identity[]>(
    `SELECT u.id,u.username,u.is_superuser AS superuser,i.scope,array_agg(DISTINCT r.code) AS roles
     FROM users u JOIN user_identities i ON i.user_id=u.id JOIN identity_roles ir ON ir.identity_id=i.id
     JOIN roles r ON r.id=ir.role_id AND r.is_enabled
     WHERE u.feishu_open_id=$1 AND u.status='enabled' AND u.deleted_at IS NULL GROUP BY u.id,i.id`,
    [openId],
  );
  const ids = new Map(items.map((item) => [item.id, item]));
  const add = (id: string, count = 1, oldest?: Date) => {
    const item = ids.get(id)!;
    if (count)
      parts.push({
        id,
        type: item.type,
        subject: item.subject_id,
        count,
        oldest: oldest ?? item.occurred_at,
      });
  };
  const whats = items
    .filter((i) => i.type.startsWith('whatsapp_'))
    .map((i) => i.id);
  if (whats.length) {
    const rows = await manager.query<
      {
        id: string;
        owner_id: string | null;
        type: NotificationType;
        count: number;
        oldest: Date | null;
      }[]
    >(
      `SELECT d.id,b.type,b.owner_id,unread.count,unread.oldest
       FROM whatsapp_notification_deliveries d JOIN whatsapp_notification_batches b ON b.id=d.batch_id
       JOIN whatsapp_conversations c ON c.id=b.conversation_id
       LEFT JOIN whatsapp_messages first_msg ON first_msg.id=b.first_message_id
       LEFT JOIN whatsapp_messages last_msg ON last_msg.id=b.latest_message_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS count,min(m.occurred_at) AS oldest FROM whatsapp_messages m
         WHERE b.type='whatsapp_message' AND m.conversation_id=c.id AND m.source='customer'
           AND m.kind NOT IN ('reaction','edit','system')
           AND ${unreadWhatsappMessageSql('c.id')}
           AND m.seq BETWEEN coalesce(first_msg.seq,(SELECT min(old.seq) FROM
              (SELECT a.seq FROM whatsapp_messages a WHERE a.conversation_id=c.id AND a.seq<=last_msg.seq
               AND a.direction='inbound' AND a.source='customer' AND a.kind NOT IN ('reaction','edit','system')
               AND NOT EXISTS(SELECT 1 FROM whatsapp_events e WHERE e.message_id=a.id AND e.kind='history_import')
               ORDER BY a.seq DESC LIMIT b.message_count) old)) AND last_msg.seq
           AND NOT EXISTS(SELECT 1 FROM whatsapp_events e WHERE e.message_id=m.id AND e.kind='history_import')
       ) unread ON true
       WHERE d.id=ANY($1::uuid[]) AND d.status='pending' AND d.open_id=$2 AND c.state='open'
       AND b.status IN ('pending','ready') AND c.owner_id IS NOT DISTINCT FROM b.owner_id
       AND (b.type<>'whatsapp_unassigned' OR b.first_message_id IS NOT NULL OR NOT EXISTS
         (SELECT 1 FROM whatsapp_notification_batches prior WHERE prior.conversation_id=b.conversation_id AND prior.type=b.type
           AND (prior.created_at,prior.id)<(b.created_at,b.id)))`,
      [whats, openId],
    );
    for (const row of rows) {
      if (
        !identities.some(
          (i) =>
            i.scope === 'website' && eligibleWhatsappRecipient(i, row.owner_id),
        )
      )
        continue;
      if (row.type === 'whatsapp_message')
        add(row.id, row.count, row.oldest ?? undefined);
      else add(row.id);
    }
  }
  const mails = items
    .filter((i) => i.type === 'mail_unassigned')
    .map((i) => i.id);
  if (
    mails.length &&
    identities.some(
      (i) =>
        i.scope === 'website' &&
        eligibleWebsiteNotificationRecipient(i, null, 'mail:thread:assign'),
    )
  ) {
    const rows = await manager.query<{ id: string }[]>(
      `SELECT d.id FROM mail_notification_deliveries d JOIN mail_threads t ON t.id=d.thread_id
       WHERE d.id=ANY($1::uuid[]) AND d.status='pending' AND d.open_id=$2 AND t.has_inbound AND t.owner_id IS NULL`,
      [mails, openId],
    );
    for (const row of rows) add(row.id);
  }
  const ledgers = items
    .filter((i) => i.type.includes('_ledger_'))
    .map((i) => i.id);
  if (ledgers.length) {
    const rows = await manager.query<
      (LedgerReminderRow & {
        job: string;
        kind: 'operate' | 'review';
        recipient: string;
      })[]
    >(
      `SELECT d.id AS job,d.kind,d.recipient_id AS recipient,l.business_unit AS "businessUnit",l.operator_id AS "operatorId",
       l.loss,l.reviewed_at AS "reviewedAt",l.operated,l.proposal_sent AS "proposalSent",l.order_status AS "orderStatus"
       FROM feishu_ledger_notifications d JOIN direct_ledgers l ON l.id=d.ledger_id
       WHERE d.id=ANY($1::uuid[]) AND d.status='pending'`,
      [ledgers],
    );
    for (const row of rows) {
      if (
        reminderKind(row) === row.kind &&
        (row.kind === 'review' || row.recipient === row.operatorId) &&
        identities.some(
          (i) =>
            i.id === row.recipient &&
            i.scope === row.businessUnit &&
            !i.superuser &&
            eligibleLedgerRecipient(row.businessUnit, row.kind, i.roles),
        )
      )
        add(row.job);
    }
  }
  const follow = items
    .filter((i) => i.type === 'inquiry_follow_up')
    .map((i) => i.id);
  if (follow.length) {
    const rows = await manager.query<
      { id: string; owner_id: string; business_unit: LoginScope }[]
    >(
      `SELECT d.id,q.owner_id,q.business_unit FROM inquiry_follow_up_reminders d JOIN inquiries q ON q.id=d.inquiry_id
       WHERE d.id=ANY($1::uuid[]) AND d.status='pending' AND d.due_at<=clock_timestamp()
       AND q.deleted_at IS NULL AND q.status NOT IN ('lost','archived')`,
      [follow],
    );
    for (const row of rows)
      if (
        identities.some(
          (i) =>
            i.id === row.owner_id &&
            i.scope === row.business_unit &&
            i.roles.includes('COORDINATOR'),
        )
      )
        add(row.id);
  }
  return parts;
}
