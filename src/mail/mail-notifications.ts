import { EntityManager } from 'typeorm';
import { notificationPolicy } from '../notifications/notification-settings';
import { websiteNotificationRecipients } from '../notifications/website-notification-recipients';
import { INBOX_FOLDER } from './mail-runtime.service';

export async function enqueueMailUnassigned(
  manager: EntityManager,
  mailbox: string,
  threadId: string,
  messageId: string,
  occurredAt: Date,
) {
  // The original mailbox scan can include mail received before notices were enabled.
  const [eligible] = await manager.query<{ id: string }[]>(
    `SELECT t.id FROM mail_threads t JOIN mail_sync s ON s.mailbox=t.mailbox AND s.folder=$2
     WHERE t.id=$1 AND t.mailbox=$3 AND t.owner_id IS NULL AND $4>=s.notify_after`,
    [threadId, INBOX_FOLDER, mailbox, occurredAt],
  );
  if (!eligible) return;
  const policy = await notificationPolicy(manager, 'mail_unassigned');
  if (!policy.enabled) return;
  const recipients = await websiteNotificationRecipients(
    manager,
    null,
    'mail:thread:assign',
  );
  for (const recipient of recipients)
    await manager.query(
      `INSERT INTO mail_notification_deliveries(thread_id,first_message_id,recipient_id,open_id,next_attempt_at,digest_at)
       VALUES($1,$2,$3,$4,coalesce($5::timestamptz,now()),$5) ON CONFLICT(thread_id,open_id) DO NOTHING`,
      [threadId, messageId, recipient.id, recipient.openId, policy.resume],
    );
}
