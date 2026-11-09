import { HttpStatus } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCodeValue } from '../common/constants/error-code';
import { Conversation, MessageStatus } from './whatsapp.types';
export function chatFail(
  code: ErrorCodeValue,
  message: string,
  status: HttpStatus,
): never {
  throw new BusinessException({ code, message, status });
}
export function chatAdmin(user: AuthenticatedUser) {
  return (
    user.scope === 'headquarters' &&
    user.roles.includes('ROOT') &&
    ['sunrise', 'mango'].includes(user.username)
  );
}
export function chatManager(user: AuthenticatedUser) {
  return (
    chatAdmin(user) ||
    (user.scope === 'website' && user.roles.includes('BUSINESS_MANAGER'))
  );
}
export function chatPermission(
  user: AuthenticatedUser,
  permission = 'whatsapp:conversation:list',
) {
  if (
    (!chatAdmin(user) && user.scope !== 'website') ||
    !user.permissions.includes(permission)
  )
    chatFail('AUTH_FORBIDDEN', '无WhatsApp工作台权限', 403);
}
export function mutableChat(c: Conversation) {
  if (c.state === 'archived')
    chatFail('CONFLICT', '旧咨询已归档，只读；请进入当前咨询', 409);
}
export function chatVersion(c: Conversation, version: number) {
  if (c.version !== version)
    chatFail('CONFLICT', '会话已更新，请刷新后重试', 409);
}
export function assertWindow(lastInboundAt: Date | null, now = Date.now()) {
  if (
    !lastInboundAt ||
    now - lastInboundAt.getTime() >= 24 * 60 * 60 * 1000 ||
    lastInboundAt.getTime() > now
  )
    chatFail('CONFLICT', '已超出24小时回复窗口，首期不支持模板发送', 409);
}
const rank: Partial<Record<MessageStatus, number>> = {
  queued: 0,
  sending: 1,
  unknown: 1,
  failed: 1,
  accepted: 2,
  sent: 3,
  delivered: 4,
  read: 5,
};
export function nextMessageStatus(
  old: MessageStatus,
  incoming: MessageStatus,
): MessageStatus {
  if (old === 'received') return old;
  if (old === 'failed' && ['accepted', 'sent'].includes(incoming)) return old;
  if (incoming === 'failed')
    return old === 'delivered' || old === 'read' ? old : 'failed';
  return (rank[incoming] ?? 0) > (rank[old] ?? 0) ? incoming : old;
}
export function sequence(value: string) {
  if (!/^\d{1,19}$/.test(value) || BigInt(value) > 9223372036854775807n)
    chatFail('VALIDATION_ERROR', '无效消息序号', 400);
  return value;
}
