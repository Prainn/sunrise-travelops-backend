import { EntityManager } from 'typeorm';

export const NOTIFICATION_TYPES = {
  whatsapp_unassigned: 'WhatsApp待分配',
  whatsapp_message: 'WhatsApp新消息',
  whatsapp_assignment: 'WhatsApp分配与改派',
  linxi_ledger_review: '霖熹台账待审核',
  linxi_ledger_operate: '霖熹台账待操作',
  website_ledger_review: '独立站台账待审核',
  website_ledger_operate: '独立站台账待操作',
  inquiry_follow_up: '询盘跟进提醒',
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export async function notificationEnabled(
  manager: EntityManager,
  type: NotificationType,
  lock = false,
  createdAt?: Date,
): Promise<boolean> {
  const [row] = await manager.query<{ enabled: boolean }[]>(
    `SELECT (enabled AND ($2::timestamptz IS NULL OR last_disabled_at IS NULL OR last_disabled_at<$2)) AS enabled FROM feishu_notification_settings WHERE type=$1${lock ? ' FOR SHARE' : ''}`,
    [type, createdAt ?? null],
  );
  return row?.enabled === true;
}
