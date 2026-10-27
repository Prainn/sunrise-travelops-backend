import {
  formatLedgerReminder,
  simulatedLedgerReminder,
  LedgerReminderData,
} from './ledger-reminder';

describe('ledger reminders', () => {
  const row: LedgerReminderData = {
    businessUnit: 'website',
    orderNo: 'WEB-123',
    creatorName: '收客甲',
    source: '来源客户',
    receivingAccountName: '独立站',
    loss: true,
    lossNote: '增加住宿成本',
  };

  it('includes business snapshots and loss details only for review', () => {
    const review = formatLedgerReminder(
      'review',
      row,
      'https://example.test/ledger',
    );
    expect(review.split('\n')[0]).toBe('【独立站】审核台账');
    expect(
      formatLedgerReminder('review', { ...row, businessUnit: 'linxi' }).split(
        '\n',
      )[0],
    ).toBe('【霖熹】审核台账');
    expect(formatLedgerReminder('operate', row).split('\n')[0]).toBe(
      '【独立站】操作台账',
    );
    for (const line of [
      '业务部门：独立站',
      '台账编号：WEB-123',
      '收客计调：收客甲',
      '来源：来源客户',
      '接单账号：独立站',
      '是否亏损：是',
      '亏损备注：增加住宿成本',
      '打开台账：https://example.test/ledger',
    ]) {
      expect(review).toContain(line);
    }
    const operate = formatLedgerReminder('operate', {
      ...row,
      businessUnit: 'linxi',
    });
    expect(operate).toContain('业务部门：霖熹');
    expect(operate.split('\n')[0]).toBe('【霖熹】操作台账');
    expect(operate).not.toContain('亏损');
  });

  it('normalizes whitespace and truncates Unicode without splitting emoji', () => {
    const text = formatLedgerReminder('review', {
      ...row,
      source: ' \n  ',
      creatorName: '甲\n乙',
      lossNote: '😀'.repeat(121),
    });
    expect(text).toContain('来源：未填写');
    expect(text).toContain('收客计调：甲 乙');
    expect(text).toContain(`亏损备注：${'😀'.repeat(120)}...`);
    expect(
      formatLedgerReminder('review', { ...row, lossNote: '😀'.repeat(120) }),
    ).not.toContain('...');
    expect(formatLedgerReminder('review', { ...row, lossNote: '' })).toContain(
      '亏损备注：未填写',
    );
  });

  it.each(['review', 'operate'] as const)(
    'marks %s simulation and avoids a fake record link',
    (kind) => {
      const text = simulatedLedgerReminder(kind);
      expect(text).toContain('【模拟提醒】');
      expect(text).toContain('来源：示例客户');
      expect(text).toContain('接单账号：定制师示例组');
      expect(text).toContain('无需处理');
      expect(text).not.toContain('打开台账');
    },
  );
});
