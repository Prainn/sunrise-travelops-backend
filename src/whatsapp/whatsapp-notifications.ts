import { EntityManager } from 'typeorm';
import { effectiveAccountPermissions } from '../auth/identity-permissions';
import {
  notificationEnabled,
  NotificationType,
} from '../notifications/notification-settings';

export type WhatsappNotificationType = Extract<
  NotificationType,
  `whatsapp_${string}`
>;
export interface NotificationConversation {
  id: string;
  owner_id: string | null;
  state: string;
  version: number;
}
export interface NotificationRecipient {
  id: string;
  openId: string;
  username: string;
  roles: string[];
}

export async function whatsappRecipients(
  manager: EntityManager,
  ownerId: string | null,
): Promise<NotificationRecipient[]> {
  const rows = await manager.query<NotificationRecipient[]>(
    `SELECT u.id,u.username,u.feishu_open_id AS "openId",array_agg(DISTINCT r.code) AS roles
     FROM users u JOIN user_identities i ON i.user_id=u.id JOIN identity_roles ir ON ir.identity_id=i.id JOIN roles r ON r.id=ir.role_id AND r.is_enabled
     WHERE u.status='enabled' AND u.deleted_at IS NULL AND btrim(u.feishu_open_id)<>'' AND i.scope='website'
     AND ($1::uuid IS NULL OR u.id=$1) GROUP BY u.id,i.id ORDER BY u.id`,
    [ownerId],
  );
  return rows.filter(
    (row) =>
      row.roles.includes(ownerId ? 'COORDINATOR' : 'BUSINESS_MANAGER') &&
      effectiveAccountPermissions(
        'website',
        row.roles,
        null,
        row.username,
      ).includes(
        ownerId ? 'whatsapp:message:send' : 'whatsapp:conversation:assign',
      ),
  );
}

export async function cancelWhatsappNotifications(
  manager: EntityManager,
  conversationId: string,
  reason: string,
) {
  await manager.query(
    `UPDATE whatsapp_notification_deliveries d SET status='skipped',error_code=$2 FROM whatsapp_notification_batches b WHERE d.batch_id=b.id AND b.conversation_id=$1 AND d.status='pending'`,
    [conversationId, reason],
  );
  await manager.query(
    `UPDATE whatsapp_notification_batches SET status='cancelled',error_code=$2 WHERE conversation_id=$1 AND status IN ('pending','ready')`,
    [conversationId, reason],
  );
}

async function deliveries(
  manager: EntityManager,
  batchId: string,
  c: NotificationConversation,
  due: Date,
) {
  const recipients = await whatsappRecipients(manager, c.owner_id);
  for (const recipient of recipients)
    await manager.query(
      `INSERT INTO whatsapp_notification_deliveries(batch_id,recipient_id,open_id,next_attempt_at) VALUES($1,$2,$3,$4) ON CONFLICT(batch_id,open_id) DO NOTHING`,
      [batchId, recipient.id, recipient.openId, due],
    );
  if (!recipients.length) {
    await manager.query(
      `UPDATE whatsapp_notification_batches SET status='skipped',error_code='RECIPIENT_UNAVAILABLE' WHERE id=$1`,
      [batchId],
    );
    await manager.query(
      'DELETE FROM whatsapp_notification_windows WHERE conversation_id=$1',
      [c.id],
    );
  }
}

/** Called within the inbound transaction, only after a new message was inserted. */
export async function enqueueWhatsappMessage(
  manager: EntityManager,
  conversationId: string,
  messageId: string,
) {
  const [c] = await manager.query<NotificationConversation[]>(
    'SELECT id,owner_id,state,version FROM whatsapp_conversations WHERE id=$1 FOR UPDATE',
    [conversationId],
  );
  if (!c || c.state !== 'open') return;
  const type: WhatsappNotificationType = c.owner_id
    ? 'whatsapp_message'
    : 'whatsapp_unassigned';
  if (!(await notificationEnabled(manager, type, true))) return;
  const [pending] = await manager.query<{ id: string }[]>(
    `SELECT id FROM whatsapp_notification_batches WHERE conversation_id=$1 AND type=$2 AND owner_id IS NOT DISTINCT FROM $3::uuid AND status='pending' AND due_at>now() AND created_at>coalesce((SELECT last_disabled_at FROM feishu_notification_settings WHERE type=$2),'-infinity'::timestamptz) ORDER BY due_at DESC LIMIT 1`,
    [conversationId, type, c.owner_id],
  );
  if (pending) {
    await manager.query(
      `UPDATE whatsapp_notification_batches SET message_count=message_count+1,latest_message_id=$2 WHERE id=$1`,
      [pending.id, messageId],
    );
    return;
  }
  const [window] = await manager.query<{ due: Date }[]>(
    `INSERT INTO whatsapp_notification_windows(conversation_id,next_at,type,setting_version) SELECT $1,now()+interval '30 seconds',type,version FROM feishu_notification_settings WHERE type=$2
    ON CONFLICT(conversation_id) DO UPDATE SET next_at=CASE WHEN whatsapp_notification_windows.type<>EXCLUDED.type OR whatsapp_notification_windows.setting_version<>EXCLUDED.setting_version THEN now()+interval '30 seconds' ELSE greatest(now(),whatsapp_notification_windows.next_at)+interval '30 seconds' END,type=EXCLUDED.type,setting_version=EXCLUDED.setting_version
    RETURNING next_at-interval '30 seconds' AS due`,
    [conversationId, type],
  );
  const [batch] = await manager.query<{ id: string }[]>(
    `INSERT INTO whatsapp_notification_batches(conversation_id,type,owner_id,message_count,latest_message_id,due_at) VALUES($1,$2,$3,1,$4,$5) RETURNING id`,
    [conversationId, type, c.owner_id, messageId, window.due],
  );
  await deliveries(manager, batch.id, c, window.due);
}

/** Conversation row is locked; the resulting version deduplicates both assignment entry points. */
export async function enqueueWhatsappAssignment(
  manager: EntityManager,
  conversationId: string,
  previousOwnerId: string | null,
) {
  const [c] = await manager.query<NotificationConversation[]>(
    'SELECT id,owner_id,state,version FROM whatsapp_conversations WHERE id=$1 FOR UPDATE',
    [conversationId],
  );
  if (!c || c.owner_id === previousOwnerId) return;
  const [existing] = await manager.query<{ id: string }[]>(
    'SELECT id FROM whatsapp_notification_batches WHERE conversation_id=$1 AND assignment_version=$2',
    [c.id, c.version],
  );
  if (existing) return;
  const enabled = await notificationEnabled(
    manager,
    'whatsapp_assignment',
    true,
  );
  const [counts] = await manager.query<{ count: number }[]>(
    `SELECT coalesce(sum(message_count),0)::int AS count FROM whatsapp_notification_batches WHERE conversation_id=$1 AND status IN ('pending','ready') AND EXISTS(SELECT 1 FROM whatsapp_notification_deliveries d WHERE d.batch_id=whatsapp_notification_batches.id AND d.status='pending')`,
    [c.id],
  );
  await cancelWhatsappNotifications(manager, c.id, 'ASSIGNMENT_CHANGED');
  await manager.query(
    'DELETE FROM whatsapp_notification_windows WHERE conversation_id=$1',
    [c.id],
  );
  if (!c.owner_id || c.state !== 'open' || !enabled) return;
  const [message] = await manager.query<{ id: string }[]>(
    `SELECT m.id FROM whatsapp_messages m WHERE m.conversation_id=$1 AND m.direction='inbound' AND m.kind NOT IN ('reaction','edit','system')
    AND NOT EXISTS(SELECT 1 FROM whatsapp_events e WHERE e.message_id=m.id AND e.kind='history_import') ORDER BY m.seq DESC LIMIT 1`,
    [c.id],
  );
  const [batch] = await manager.query<{ id: string; due: Date }[]>(
    `INSERT INTO whatsapp_notification_batches(conversation_id,type,owner_id,previous_owner_id,assignment_version,message_count,latest_message_id,due_at) VALUES($1,'whatsapp_assignment',$2,$3,$4,$5,$6,now()) RETURNING id,due_at AS due`,
    [
      c.id,
      c.owner_id,
      previousOwnerId,
      c.version,
      counts.count,
      message?.id ?? null,
    ],
  );
  await deliveries(manager, batch.id, c, batch.due);
  await manager.query(
    `INSERT INTO whatsapp_notification_windows(conversation_id,next_at,type,setting_version) SELECT $1,now()+interval '30 seconds',type,version FROM feishu_notification_settings WHERE type='whatsapp_message' ON CONFLICT(conversation_id) DO UPDATE SET next_at=EXCLUDED.next_at,type=EXCLUDED.type,setting_version=EXCLUDED.setting_version`,
    [c.id],
  );
}

export function notificationSummary(text: string, kind: string) {
  const media: Record<string, string> = {
    image: '图片',
    audio: '语音',
    voice: '语音',
    video: '视频',
    document: '文件',
    file: '文件',
    sticker: '贴纸',
    location: '位置',
    contacts: '联系人',
  };
  if (kind !== 'text') return `[${media[kind] ?? '客户消息'}]`;
  const chars = Array.from(text.replace(/\s+/gu, ' ').trim());
  return chars.slice(0, 120).join('') + (chars.length > 120 ? '…' : '');
}
