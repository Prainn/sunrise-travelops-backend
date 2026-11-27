import type { Request } from 'express';
import type { OperationCategory } from './operation-logs.service';

export function isUserAction(req: Pick<Request, 'headers'>) {
  return req.headers?.['x-operation-origin'] === 'user';
}

// An undefined IP skips the transactional audit entry for an unmarked caller.
export function userActionIp(req: Request) {
  return isUserAction(req) ? (req.ip ?? '') : undefined;
}

const whatsappCommands: Record<string, string> = {
  send: '发送消息',
  sendDocument: '发送文件',
  sendImageBatch: '发送图片',
  react: '回应消息',
  retry: '重试发送',
  confirmFailed: '确认未送达',
  saveCustomerNotes: '保存客户备注',
  assign: '分配会话',
  state: '变更会话状态',
  newConsultation: '开启新会话',
  inquiry: '从会话新增询盘',
  documentDownload: '获取文件下载链接',
};
const mailCommands: Record<string, string> = {
  assign: '分配邮件会话',
  saveCustomerNotes: '保存客户备注',
  open: '打开回复草稿',
  save: '保存回复草稿',
  discard: '删除回复草稿',
  attach: '添加邮件附件',
  remove: '移除邮件附件',
  send: '发送回复',
  inquiry: '从来信新增询盘',
  download: '获取邮件附件下载链接',
};
const accountCommands: Record<string, string> = {
  create: '建立账号关联',
  update: '调整账号关联',
  delete: '解除账号关联',
};
export function additionalCommand(
  controller: string,
  handler: string,
): { category: OperationCategory; label: string } | null {
  if (controller === 'AuthController' && handler === 'switchAccount')
    return { category: 'login', label: '切换账号' };
  if (controller === 'AccountLinksController' && accountCommands[handler])
    return { category: 'user', label: accountCommands[handler] };
  if (controller === 'MailController' && mailCommands[handler])
    return { category: 'mail', label: mailCommands[handler] };
  if (controller === 'WhatsappController' && whatsappCommands[handler])
    return {
      category: 'whatsapp',
      label: 'WhatsApp会话 / ' + whatsappCommands[handler],
    };
  return null;
}

export function writesOwnSuccess(controller: string, handler: string) {
  return (
    (controller === 'AuthController' && handler === 'switchAccount') ||
    (controller === 'AccountLinksController' &&
      Boolean(accountCommands[handler]))
  );
}
