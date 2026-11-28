import { NOTIFICATION_TYPES } from '../notifications/notification-settings';

function summary(value: string) {
  const chars = Array.from(value.replace(/\s+/gu, ' ').trim());
  return chars.slice(0, 120).join('') + (chars.length > 120 ? '…' : '');
}

export function formatMailUnassignedReminder(
  name: string,
  subject: string,
  occurredAt: Date,
  url?: string,
) {
  return [
    `【${NOTIFICATION_TYPES.mail_unassigned}】`,
    `客户：${summary(name) || '未命名客户'}`,
    `邮件主题：${summary(subject) || '无主题'}`,
    `收到时间：${occurredAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`,
    '可使用独立站账号查看邮件，负责人由总部 mango 账号分配。',
    ...(url ? [`查看会话：${url}`] : []),
  ].join('\n');
}
