import { ChatMessage } from './whatsapp.types';

export interface MessageAlias {
  id: string;
  providerId: string | null;
  externalId: string | null;
}
export interface MessagePresentation {
  text: string;
  editedAt: Date | null;
  hidden: boolean;
  interaction: 'reaction' | 'edit' | null;
  emoji: string | null;
  targetMessageId: string | null;
  reactions: {
    id: string;
    seq: string;
    direction: ChatMessage['direction'];
    emoji: string | null;
    source: ChatMessage['source'];
    status: ChatMessage['status'];
  }[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
export function interaction(message: ChatMessage) {
  const content = message.attachment ?? {};
  const edit = record(content.edit);
  if (message.kind === 'edit' || content.type === 'edit') {
    return {
      type: 'edit' as const,
      target: string(edit.original_message_id),
      text: string(record(record(edit.message).text).body),
      emoji: null,
    };
  }
  if (message.kind === 'reaction') {
    return {
      type: 'reaction' as const,
      // Historical ListChatappMessage uses messageCode (provider ID) and
      // message_id (WhatsApp ID); our outbox stores the local target as well.
      target:
        string(content.targetMessageId) ||
        string(content.messageCode) ||
        string(content.messageId) ||
        string(content.message_id),
      text: '',
      emoji: typeof content.emoji === 'string' ? content.emoji : null,
    };
  }
  return null;
}

/** Project immutable event rows onto bubbles; pagination and read cursors keep their original rows. */
export function presentMessages(
  page: ChatMessage[],
  aliases: MessageAlias[],
  changes: ChatMessage[],
) {
  const ids = new Map<string, string>();
  for (const item of aliases) {
    ids.set(item.id, item.id);
    if (item.providerId) ids.set(item.providerId, item.id);
    if (item.externalId) ids.set(item.externalId, item.id);
  }
  const edits = new Map<string, ChatMessage>();
  const reactions = new Map<string, Map<string, ChatMessage>>();
  const ordered = [...changes].sort(
    (a, b) =>
      new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime() ||
      (BigInt(a.seq) === BigInt(b.seq)
        ? 0
        : BigInt(a.seq) < BigInt(b.seq)
          ? -1
          : 1),
  );
  for (const message of ordered) {
    const change = interaction(message);
    const target = change && ids.get(change.target);
    if (!change || !target || target === message.id) continue;
    if (change.type === 'edit') {
      edits.set(target, message);
    } else if (!['failed', 'unknown'].includes(message.status)) {
      const bySender = reactions.get(target) ?? new Map<string, ChatMessage>();
      bySender.set(message.direction, message);
      reactions.set(target, bySender);
    }
  }
  return page.map((message) => {
    const change = interaction(message);
    const edit = edits.get(message.id);
    const presentation: MessagePresentation = {
      text: edit
        ? interaction(edit)!.text
        : change
          ? change.text
          : message.text,
      editedAt:
        edit?.occurredAt ??
        (change?.type === 'edit' ? message.occurredAt : null),
      hidden:
        !!change &&
        !!ids.get(change.target) &&
        ids.get(change.target) !== message.id &&
        !['failed', 'unknown'].includes(message.status),
      interaction: change?.type ?? null,
      emoji: change?.emoji ?? null,
      targetMessageId: change ? (ids.get(change.target) ?? null) : null,
      reactions: [...(reactions.get(message.id)?.values() ?? [])]
        .filter((item) => interaction(item)?.emoji !== '')
        .map((item) => ({
          id: item.id,
          seq: item.seq,
          direction: item.direction,
          emoji: interaction(item)!.emoji,
          source: item.source,
          status: item.status,
        })),
    };
    return { ...message, presentation };
  });
}
