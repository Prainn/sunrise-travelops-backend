export type LedgerReminderKind = 'review' | 'operate';

export interface LedgerReminderData {
  businessUnit: 'linxi' | 'website';
  orderNo: string;
  creatorName: string;
  source: string;
  receivingAccountName: string;
  loss: boolean;
  lossNote: string;
}

function summary(value: string): string {
  const characters = Array.from(value.trim().replace(/\s+/gu, ' '));
  if (!characters.length) return '未填写';
  return (
    characters.slice(0, 120).join('') + (characters.length > 120 ? '...' : '')
  );
}

export function formatLedgerReminder(
  kind: LedgerReminderKind,
  row: LedgerReminderData,
  ledgerUrl?: string,
): string {
  return [
    `【${row.businessUnit === 'linxi' ? '霖熹' : '独立站'}】${kind === 'review' ? '审核' : '操作'}台账`,
    `业务部门：${row.businessUnit === 'linxi' ? '霖熹' : '独立站'}`,
    `台账编号：${summary(row.orderNo)}`,
    `收客计调：${summary(row.creatorName)}`,
    `来源：${summary(row.source)}`,
    `接单账号：${summary(row.receivingAccountName)}`,
    ...(kind === 'review'
      ? [
          `是否亏损：${row.loss ? '是' : '否'}`,
          `亏损备注：${summary(row.lossNote)}`,
        ]
      : []),
    kind === 'review'
      ? '请审核并确认亏损台账。'
      : '已发送方案且已成团，请处理。',
    ...(ledgerUrl ? [`打开台账：${ledgerUrl}`] : []),
  ].join('\n');
}

export function simulatedLedgerReminder(kind: LedgerReminderKind): string {
  return [
    '【模拟提醒】',
    formatLedgerReminder(kind, {
      businessUnit: 'linxi',
      orderNo: 'TEST-0001',
      creatorName: '示例收客计调',
      source: '示例客户',
      receivingAccountName: '定制师示例组',
      loss: kind === 'review',
      lossNote:
        '模拟情况：客人调整行程后住宿和交通成本增加，申请按原报价执行。',
    }),
    '以上为模拟台账数据，仅用于测试提醒，无需处理。',
  ].join('\n');
}
