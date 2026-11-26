import {
  NOTIFICATION_TYPES,
  NotificationType,
} from '../notifications/notification-settings';
import type { DigestPart } from '../notifications/notification-digest-items';

const labels: Record<NotificationType, [string, string, string]> = {
  whatsapp_message: ['WhatsApp 客户消息未读', '条', 'WhatsApp 未读消息'],
  whatsapp_unassigned: ['WhatsApp 会话待分配', '个', 'WhatsApp 会话待分配提醒'],
  whatsapp_assignment: [
    'WhatsApp 会话分配与改派',
    '个',
    'WhatsApp 会话分配与改派提醒',
  ],
  linxi_ledger_review: ['霖熹台账待审核', '笔', '霖熹台账审核提醒'],
  linxi_ledger_operate: ['霖熹台账待操作', '笔', '霖熹台账操作提醒'],
  website_ledger_review: ['独立站台账待审核', '笔', '独立站台账审核提醒'],
  website_ledger_operate: ['独立站台账待操作', '笔', '独立站台账操作提醒'],
  inquiry_follow_up: ['询盘跟进提醒', '个', '询盘跟进提醒'],
};

export function formatNotificationDigest(
  parts: DigestPart[],
  url: string,
  now = Date.now(),
) {
  const counts = new Map<NotificationType, number>();
  const subjects = new Set<string>();
  let oldest = parts[0];
  for (const part of parts) {
    if (part.oldest < oldest.oldest) oldest = part;
    const key = `${part.type}/${part.subject}`;
    if (part.type !== 'whatsapp_message' && subjects.has(key)) continue;
    subjects.add(key);
    counts.set(part.type, (counts.get(part.type) ?? 0) + part.count);
  }
  const minutes = Math.max(
    0,
    Math.floor((now - oldest.oldest.getTime()) / 60000),
  );
  const age = `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
  const lines = ['【业务通知汇总】'];
  if (counts.size === 1 && counts.has('whatsapp_message'))
    lines.push(
      `你有 ${counts.get('whatsapp_message')} 条 WhatsApp 客户消息未读，最早一条是 ${age}前收到的。`,
      `查看 WhatsApp 收件箱：${url}`,
    );
  else {
    for (const type of Object.keys(NOTIFICATION_TYPES) as NotificationType[]) {
      if (counts.has(type))
        lines.push(`${labels[type][0]} ${counts.get(type)} ${labels[type][1]}`);
    }
    lines.push(
      `最早一项是 ${age}前的${labels[oldest.type][2]}，请及时查看。`,
      `进入系统查看：${url}`,
    );
  }
  return lines.join('\n');
}
