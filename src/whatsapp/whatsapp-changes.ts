import { EntityManager } from 'typeorm';

export const WHATSAPP_CHANGES_CHANNEL = 'whatsapp_changes';
export const CHANGE_REASONS = [
  'message',
  'status',
  'state',
  'assign',
  'notes',
  'inquiry',
  'read',
  'consultation',
] as const;
export type ChangeReason = (typeof CHANGE_REASONS)[number];
export type WhatsappChange =
  { conversationId: string; reason: ChangeReason } | { type: 'resync' };

export function parseWhatsappChange(payload: string): WhatsappChange {
  if (Buffer.byteLength(payload, 'utf8') >= 8000)
    throw new Error('INVALID_CHANGE');
  const value: unknown = JSON.parse(payload);
  if (!value || typeof value !== 'object') throw new Error('INVALID_CHANGE');
  if (
    'type' in value &&
    value.type === 'resync' &&
    Object.keys(value).length === 1
  )
    return { type: 'resync' };
  if (
    'conversationId' in value &&
    typeof value.conversationId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.conversationId,
    ) &&
    'reason' in value &&
    CHANGE_REASONS.includes(value.reason as ChangeReason) &&
    Object.keys(value).length === 2
  )
    return {
      conversationId: value.conversationId,
      reason: value.reason as ChangeReason,
    };
  throw new Error('INVALID_CHANGE');
}

/** The caller's business transaction owns delivery, including SAVEPOINT rollback. */
export async function notifyWhatsappChange(
  manager: EntityManager,
  change: WhatsappChange,
) {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('WHATSAPP_NOTIFY_REQUIRES_TRANSACTION');
  const payload = JSON.stringify(change);
  parseWhatsappChange(payload);
  await manager.query('SELECT pg_notify($1,$2)', [
    WHATSAPP_CHANGES_CHANNEL,
    payload,
  ]);
}
