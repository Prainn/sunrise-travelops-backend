import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCodeValue } from '../common/constants/error-code';
import { AuthenticatedUser } from '../auth/auth.types';
import { isFullAdministrator } from '../auth/account-access';

export const MAILBOX = 'biz@lynxtour.cn';
export type MailAddress = { email: string; name?: string };
export type MailState =
  | 'received'
  | 'draft'
  | 'preparing'
  | 'sending'
  | 'unknown'
  | 'failed'
  | 'sent';
export interface MailThread {
  id: string;
  mailbox: string;
  subject: string;
  customerEmail: string;
  customerName: string;
  ownerId: string | null;
  ownerName: string | null;
  inquiryId: string | null;
  sourceMessageId: string | null;
  assignmentLocked: boolean;
  version: number;
  lastAt: Date;
  unreadCount: number;
}
export interface MailFile {
  id: string;
  fileName: string;
  sizeBytes: number;
  available: boolean;
}
export interface MailMessage {
  id: string;
  threadId: string;
  direction: 'inbound' | 'outbound';
  state: MailState;
  subject: string;
  sender: MailAddress;
  recipients: MailAddress[];
  cc: MailAddress[];
  replyTo: MailAddress[];
  body: string;
  occurredAt: Date;
  actorId: string | null;
  originalId: string | null;
  signature: string | null;
  version: number;
  isRead: boolean;
  internetId: string | null;
  refs: string[];
  attachments: MailFile[];
}

export function mailFail(
  code: ErrorCodeValue,
  message: string,
  status: HttpStatus,
): never {
  throw new BusinessException({ code, message, status });
}
export function mailManager(user: AuthenticatedUser) {
  return (
    isFullAdministrator(user) ||
    (user.scope === 'website' && user.roles.includes('BUSINESS_MANAGER'))
  );
}
export function requireMail(user: AuthenticatedUser, permission: string) {
  if (
    (!isFullAdministrator(user) && user.scope !== 'website') ||
    !user.permissions.includes(permission)
  )
    mailFail('AUTH_FORBIDDEN', '无邮件收件箱操作权限', 403);
}
export function mailSignature(name: string) {
  return `Best regards,\n\n${name}\nTravel Consultant\nLynxtour\nWhatsapp: +8613211685553\nEmail: ${MAILBOX}\nWebsite: https://lynxtour.cn/`;
}
function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}
export function replyBody(body: string, name: string) {
  const signature = mailSignature(name);
  const lines = signature.split('\n');
  const contact = lines.slice(2, 6).map(escapeHtml).join('<br>');
  return {
    bodyText: `${body}\n\n${signature}`,
    bodyHtml: `<p>${escapeHtml(body).replace(/\r?\n/g, '<br>')}</p><p>Best regards,</p><p><strong>${contact}<br>Email: <a href="mailto:${MAILBOX}">${MAILBOX}</a><br>Website: <a href="https://lynxtour.cn/">https://lynxtour.cn/</a></strong></p>`,
  };
}
export function headerIds(value: string | undefined) {
  if (!value) return [];
  const tokens = value.match(/<[^<>\s]+>/g) ?? value.trim().split(/\s+/);
  return tokens
    .map((s) => s.replace(/^<|>$/g, ''))
    .filter((s) => /^[^<>\s\p{Cc}]+@[^<>\s\p{Cc}]+$/u.test(s));
}
export function readableText(body?: { bodyText?: string; bodyHtml?: string }) {
  if (body?.bodyText?.trim()) return body.bodyText;
  // The workbench uses Vue text interpolation; external markup is never mounted.
  return (body?.bodyHtml ?? '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(?:p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi,
      (match: string, key: string) => {
        const named: Record<string, string> = {
          amp: '&',
          lt: '<',
          gt: '>',
          quot: '"',
          apos: "'",
          nbsp: ' ',
        };
        if (key[0] !== '#') return named[key.toLowerCase()] ?? match;
        const n = /^#x/i.test(key)
          ? parseInt(key.slice(2), 16)
          : Number(key.slice(1));
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
      },
    )
    .trim();
}
