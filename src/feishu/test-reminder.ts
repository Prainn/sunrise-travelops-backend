import type { NotificationType } from '../notifications/notification-settings';
import { formatInquiryFollowUpReminder } from './inquiry-follow-up-reminder';
import { simulatedLedgerReminder } from './ledger-reminder';
import { formatWhatsAppReminder } from './whatsapp-reminder';

export function formatFeishuTestReminder(template: NotificationType): string {
  switch (template) {
    case 'linxi_ledger_review':
      return simulatedLedgerReminder('review');
    case 'linxi_ledger_operate':
      return simulatedLedgerReminder('operate');
    case 'website_ledger_review':
      return simulatedLedgerReminder('review', 'website');
    case 'website_ledger_operate':
      return simulatedLedgerReminder('operate', 'website');
    case 'inquiry_follow_up':
      return [
        '【模拟提醒】',
        formatInquiryFollowUpReminder('TEST-0001', '2026-01-15T02:00:00Z'),
        '以上为模拟询盘数据，仅用于测试提醒，无需处理。',
      ].join('\n');
    case 'whatsapp_unassigned':
    case 'whatsapp_message':
    case 'whatsapp_assignment':
      return [
        '【模拟提醒】',
        formatWhatsAppReminder({
          type: template,
          previous_owner_id: null,
          name: '示例客户',
          message_count:
            template === 'whatsapp_message'
              ? 2
              : template === 'whatsapp_unassigned'
                ? 1
                : 0,
          kind: 'text',
          text: '你好，想了解云南的定制行程。',
          occurred_at: new Date('2026-01-15T01:30:00Z'),
        }),
        '以上为模拟会话数据，仅用于测试提醒，无需处理。',
      ].join('\n');
  }
}
