import { ChatMessage } from './whatsapp.types';
import { presentMessages } from './whatsapp.presentation';

const message = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({
    id,
    seq: '1',
    providerId: `provider-${id}`,
    kind: 'text',
    text: 'original',
    attachment: null,
    status: 'received',
    direction: 'inbound',
    source: 'customer',
    occurredAt: new Date('2026-11-10T01:00:00Z'),
    ...extra,
  }) as ChatMessage;
const aliases = [
  {
    id: 'original',
    providerId: 'provider-original',
    externalId: 'wamid-original',
  },
];

describe('WhatsApp bubble projection', () => {
  it('replaces original display text through the historical WhatsApp ID, retaining the immutable rows', () => {
    const original = message('original');
    const edit = message('edit', {
      seq: '2',
      kind: 'edit',
      text: '[历史消息编辑记录]\nchanged',
      attachment: {
        edit: {
          original_message_id: 'wamid-original',
          message: { text: { body: 'changed' } },
        },
      },
    });
    const projected = presentMessages([original, edit], aliases, [edit]);
    expect(projected[0].presentation).toMatchObject({
      text: 'changed',
      editedAt: edit.occurredAt,
    });
    expect(projected[1].presentation.hidden).toBe(true);
    expect(original.text).toBe('original');
  });
  it('attaches known reactions, keeps missing metadata unlinked, and never invents an emoji', () => {
    const reaction = message('r', {
      seq: '2',
      kind: 'reaction',
      attachment: { messageCode: 'provider-original', emoji: '👍' },
    });
    const unknown = message('unknown', { seq: '3', kind: 'reaction' });
    const [original, known, missing] = presentMessages(
      [message('original'), reaction, unknown],
      aliases,
      [reaction, unknown],
    );
    expect(original.presentation.reactions).toEqual([
      expect.objectContaining({ emoji: '👍' }),
    ]);
    expect(known.presentation.hidden).toBe(true);
    expect(missing.presentation).toMatchObject({
      text: '',
      emoji: null,
      targetMessageId: null,
      hidden: false,
    });
  });
  it('uses one current reaction per sender, supports removal and leaves failed sends visible for retry', () => {
    const reaction = message('r', {
      kind: 'reaction',
      attachment: { messageId: 'provider-original', emoji: '👍' },
    });
    const remove = message('remove', {
      seq: '2',
      kind: 'reaction',
      attachment: { messageId: 'provider-original', emoji: '' },
    });
    const failed = message('failed', {
      seq: '3',
      kind: 'reaction',
      status: 'failed',
      attachment: { targetMessageId: 'original', emoji: '❤️' },
    });
    const [original, failure] = presentMessages(
      [message('original'), failed],
      aliases,
      [reaction, remove, failed],
    );
    expect(original.presentation.reactions).toEqual([]);
    expect(failure.presentation.hidden).toBe(false);
  });
  it('projects changes outside the requested page without altering pagination rows', () => {
    const reaction = message('r', {
      seq: '100',
      kind: 'reaction',
      attachment: { messageId: 'provider-original', emoji: '🙏' },
    });
    expect(
      presentMessages([message('original')], aliases, [reaction]),
    ).toHaveLength(1);
    expect(
      presentMessages([message('original')], aliases, [reaction])[0]
        .presentation.reactions[0].emoji,
    ).toBe('🙏');
  });
});
