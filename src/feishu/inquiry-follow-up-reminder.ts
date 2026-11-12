export function formatInquiryFollowUpReminder(
  code: string,
  nextFollowUpAt: Date | string | null,
): string {
  const when = nextFollowUpAt
    ? new Date(nextFollowUpAt).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      })
    : '';
  return `询盘跟进提醒\n询盘：${code}\n下次跟进：${when}\n请登录系统查看跟进记录。`;
}
