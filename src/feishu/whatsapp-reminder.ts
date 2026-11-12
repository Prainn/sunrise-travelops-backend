import type { WhatsappNotificationType } from '../whatsapp/whatsapp-notifications';

interface WhatsAppReminderData {
  type: WhatsappNotificationType;
  previous_owner_id: string | null;
  name: string;
  message_count: number;
  kind: string | null;
  text: string | null;
  occurred_at: Date | null;
}

function notificationSummary(text: string, kind: string) {
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

export function formatWhatsAppReminder(
  data: WhatsAppReminderData,
  conversationUrl?: string,
): string {
  const {
    type,
    name,
    previous_owner_id,
    message_count,
    kind,
    text,
    occurred_at,
  } = data;
  const title =
    type === 'whatsapp_assignment'
      ? previous_owner_id
        ? '改派提醒'
        : '分配提醒'
      : type === 'whatsapp_unassigned'
        ? '待分配'
        : '新消息待回复';
  return [
    `【WhatsApp ${title}】`,
    `客户：${notificationSummary(name, 'text')}`,
    ...(message_count ? [`新增消息：${message_count}条`] : []),
    ...(kind ? [`最新消息：${notificationSummary(text ?? '', kind)}`] : []),
    ...(occurred_at
      ? [
          `收到时间：${occurred_at.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）`,
        ]
      : []),
    type === 'whatsapp_unassigned'
      ? '请进入系统分配负责人。'
      : type === 'whatsapp_assignment'
        ? '咨询已分配给你，请查看并跟进。'
        : '客户有新消息，请查看并回复。',
    ...(conversationUrl ? [`查看会话：${conversationUrl}`] : []),
  ].join('\n');
}
