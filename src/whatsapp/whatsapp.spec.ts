import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { effectiveAccountPermissions } from '../auth/identity-permissions';
import { WhatsappConfig } from './whatsapp.config';
import { assertWindow, nextMessageStatus, sequence } from './whatsapp.policy';
import { eventKey, normalizeEvent } from './whatsapp.events';
import { ChatAccount } from './whatsapp.types';
import {
  AssignChatDto,
  CreateChatInquiryDto,
  SendTextDto,
} from './whatsapp.dto';
import { randomUUID } from 'node:crypto';
const account: ChatAccount = {
  id: 'synthetic-account',
  spaceId: 'synthetic-space',
  wabaId: 'synthetic-waba',
  phone: '0000000000',
};
const event = {
  MessageId: 'synthetic-id',
  CustSpaceId: account.spaceId,
  WabaId: account.wabaId,
  FromUserId: 'ZZ.synthetic',
  To: account.phone,
  Type: 'TEXT',
  Message: 'Synthetic text',
  Timestamp: Date.now(),
};
describe('WhatsApp identity, event and window boundaries', () => {
  it('uses From for status account verification even when OriginPhoneNumber differs', () => {
    const receipt = {
      ...event,
      From: account.phone,
      To: '0000000001',
      OriginPhoneNumber: '0000000001',
      Status: 'Delivered',
    };
    expect(normalizeEvent(receipt, 'status', account).status).toBe('delivered');
    expect(() =>
      normalizeEvent(
        { ...receipt, From: '0000000002', OriginPhoneNumber: account.phone },
        'status',
        account,
      ),
    ).toThrow('ACCOUNT_MISMATCH');
    expect(() =>
      normalizeEvent({ ...receipt, CustSpaceId: 'other' }, 'status', account),
    ).toThrow('ACCOUNT_MISMATCH');
    expect(() =>
      normalizeEvent({ ...receipt, WabaId: 'other' }, 'status', account),
    ).toThrow('ACCOUNT_MISMATCH');
    expect(
      normalizeEvent(
        { ...receipt, From: undefined, OriginPhoneNumber: account.phone },
        'status',
        account,
      ).status,
    ).toBe('delivered');
  });
  it('preserves inbound Context for text and media without losing metadata', () => {
    const Context = { id: 'quoted-provider-id', from: account.phone };
    expect(
      normalizeEvent({ ...event, Context }, 'inbound', account).attachment,
    ).toEqual({ contextMessageId: Context.id });
    expect(
      normalizeEvent(
        { ...event, Type: 'IMAGE', Message: { id: 'media' }, Context },
        'inbound',
        account,
      ).attachment,
    ).toEqual({ id: 'media', contextMessageId: Context.id });
    expect(normalizeEvent(event, 'inbound', account).attachment).toBeNull();
    expect(() =>
      normalizeEvent({ ...event, Context: { id: 42 } }, 'inbound', account),
    ).toThrow('INVALID_EVENT');
  });
  it('supports BSUID without a phone', () => {
    expect(normalizeEvent(event, 'inbound', account)).toMatchObject({
      bsuid: 'ZZ.synthetic',
      phone: '',
      echo: false,
    });
  });
  it('supports phone-only events and BSUID in From', () => {
    expect(
      normalizeEvent(
        { ...event, FromUserId: undefined, From: '0000000001' },
        'inbound',
        account,
      ).phone,
    ).toBe('0000000001');
    expect(
      normalizeEvent(
        { ...event, FromUserId: undefined, From: 'ZZ.synthetic' },
        'inbound',
        account,
      ).bsuid,
    ).toBe('ZZ.synthetic');
  });
  it('identifies mobile echo without attributing an employee', () => {
    expect(
      normalizeEvent(
        {
          ...event,
          NoticeType: 'echos',
          From: account.phone,
          To: 'ZZ.synthetic',
          UserId: 'ZZ.synthetic',
        },
        'inbound',
        account,
      ),
    ).toMatchObject({ echo: true, bsuid: 'ZZ.synthetic' });
  });
  it.each([
    { CustSpaceId: 'other' },
    { WabaId: 'other' },
    { To: 'other' },
    { Timestamp: Date.now() + 120000 },
    { NoticeType: 'history outbound' },
    { FromUserId: undefined },
    { Message: 3 },
  ])('rejects invalid/untrusted event %j', (override) => {
    expect(() =>
      normalizeEvent({ ...event, ...override }, 'inbound', account),
    ).toThrow();
  });
  it('preserves media metadata without downloading or executing it', () => {
    expect(
      normalizeEvent(
        {
          ...event,
          Type: 'DOCUMENT',
          Message: JSON.stringify({
            id: 'synthetic-media',
            filename: 'test.pdf',
            url: 'https://example.invalid/test.pdf',
          }),
        },
        'inbound',
        account,
      ).attachment,
    ).toMatchObject({ filename: 'test.pdf' });
  });
  it('deduplicates object-order changes but preserves distinct payloads', () => {
    expect(eventKey({ a: 1, b: 2 })).toBe(eventKey({ b: 2, a: 1 }));
    expect(eventKey({ a: 1 })).not.toBe(eventKey({ a: 2 }));
  });
  it('window boundary is last customer inbound, exactly 24h excluded', () => {
    const now = Date.now();
    expect(() => assertWindow(new Date(now - 86400000), now)).toThrow();
    expect(() => assertWindow(null, now)).toThrow();
    expect(() => assertWindow(new Date(now - 86399999), now)).not.toThrow();
  });
  it('delivery status does not regress on delayed receipts', () => {
    expect(nextMessageStatus('read', 'sent')).toBe('read');
    expect(nextMessageStatus('delivered', 'failed')).toBe('delivered');
    expect(nextMessageStatus('unknown', 'read')).toBe('read');
    expect(nextMessageStatus('sent', 'failed')).toBe('failed');
    expect(nextMessageStatus('failed', 'sent')).toBe('failed');
    expect(nextMessageStatus('failed', 'read')).toBe('read');
  });
  it('bounds bigint sequence inputs', () => {
    expect(() => sequence('9223372036854775808')).toThrow();
    expect(() => sequence('-1')).toThrow();
    expect(sequence('9223372036854775807')).toBe('9223372036854775807');
  });
});
describe('WhatsApp configuration and permissions', () => {
  const base = {
    WHATSAPP_CHAT_ENABLED: 'true',
    WHATSAPP_CHAT_SPACE_ID: 'synthetic-space',
    WHATSAPP_CHAT_WABA_ID: 'synthetic-waba',
    WHATSAPP_CHAT_PHONE: '0000000000',
    WHATSAPP_CHAT_SEND_ENABLED: 'true',
  };
  const config = (extra: Record<string, string> = {}) =>
    new WhatsappConfig(new ConfigService({ ...base, ...extra }));
  it('disabled by default and cannot send without explicit configuration', () => {
    const c = new WhatsappConfig(new ConfigService({}));
    expect(c.enabled).toBe(false);
    expect(() => c.assertSend('ZZ.synthetic')).toThrow();
  });
  it('test environment fails closed without allowlist', () => {
    expect(() => config().assertSend('ZZ.synthetic')).toThrow();
    expect(() =>
      config({ WHATSAPP_CHAT_TEST_RECIPIENTS: 'ZZ.synthetic' }).assertSend(
        'ZZ.synthetic',
      ),
    ).not.toThrow();
  });
  it('only explicit production permits non-allowlisted recipients', () => {
    expect(() =>
      config({ WHATSAPP_CHAT_ENVIRONMENT: 'production' }).assertSend(
        'ZZ.synthetic',
      ),
    ).not.toThrow();
  });
  it('send capability and actual send use the same blocked reasons', () => {
    expect(
      config({ WHATSAPP_CHAT_ENABLED: 'false' }).sendBlockedReason(
        'ZZ.synthetic',
      ),
    ).toBe('not_configured');
    expect(
      config({ WHATSAPP_CHAT_SEND_ENABLED: 'false' }).sendBlockedReason(
        'ZZ.synthetic',
      ),
    ).toBe('send_disabled');
    expect(config().sendBlockedReason('ZZ.synthetic')).toBe('test_recipient');
    expect(
      config({
        WHATSAPP_CHAT_TEST_RECIPIENTS: 'ZZ.synthetic',
      }).sendBlockedReason('ZZ.synthetic'),
    ).toBeNull();
    expect(
      config({ WHATSAPP_CHAT_ENVIRONMENT: 'production' }).sendBlockedReason(
        'ZZ.other',
      ),
    ).toBeNull();
  });
  it('HTTP token requires strong exact bearer auth', () => {
    const c = config({
      WHATSAPP_CHAT_HTTP_TOKEN: 'synthetic-token-32-characters-long-only',
    });
    expect(() => c.authorize(undefined, 'HTTP_TOKEN')).toThrow();
    expect(() => c.authorize('Bearer wrong', 'HTTP_TOKEN')).toThrow();
    expect(() =>
      c.authorize(
        'Bearer synthetic-token-32-characters-long-only',
        'HTTP_TOKEN',
      ),
    ).not.toThrow();
  });
  it.each(['linxi', 'shengxu', 'headquarters'] as const)(
    '%s has no WhatsApp grants for generic users',
    (scope) => {
      expect(
        effectiveAccountPermissions(
          scope,
          scope === 'headquarters' ? ['ROOT'] : ['BUSINESS_MANAGER'],
          null,
          'generic',
        ).filter((p) => p.startsWith('whatsapp:')),
      ).toEqual([]);
    },
  );
  it('only mango headquarters ROOT has module permissions', () => {
    const username = 'mango';
    expect(
      effectiveAccountPermissions(
        'headquarters',
        ['ROOT'],
        null,
        username,
      ).filter((p) => p.startsWith('whatsapp:')),
    ).toHaveLength(7);
    expect(
      effectiveAccountPermissions(
        'linxi',
        ['COORDINATOR'],
        null,
        username,
      ).filter((p) => p.startsWith('whatsapp:')),
    ).toHaveLength(0);
  });
  it('website coordinator cannot assign or administer integration', () => {
    const permissions = effectiveAccountPermissions(
      'website',
      ['COORDINATOR'],
      'both',
      'synthetic',
    );
    expect(permissions).toContain('whatsapp:message:send');
    expect(permissions).not.toContain('whatsapp:conversation:assign');
    expect(permissions).not.toContain('whatsapp:integration:manage');
  });
});
describe('WhatsApp DTO boundary', () => {
  it('allows only a local UUID as the quoted message target, never a provider override', () => {
    const base = { clientRequestId: randomUUID(), text: 'reply' };
    expect(
      validateSync(
        plainToInstance(SendTextDto, {
          ...base,
          replyToMessageId: randomUUID(),
        }),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(SendTextDto, {
          ...base,
          replyToMessageId: 'provider-id',
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(
        plainToInstance(SendTextDto, {
          ...base,
          contextMessageId: 'provider-id',
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ).length,
    ).toBeGreaterThan(0);
  });
  it('rejects empty text and additional fields', () => {
    const dto = plainToInstance(SendTextDto, {
      clientRequestId: randomUUID(),
      text: '  ',
      from: 'spoofed',
    });
    expect(
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length,
    ).toBeGreaterThan(0);
  });
  it('cannot override owner or business unit on inquiry creation', () => {
    const dto = plainToInstance(CreateChatInquiryDto, {
      version: 1,
      countryItemId: randomUUID(),
      customerName: 'Synthetic',
      plannedDays: 1,
      requirements: 'Synthetic',
      ownerId: randomUUID(),
      businessUnit: 'linxi',
    });
    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['ownerId', 'businessUnit']),
    );
  });
});

describe('WhatsApp optional assignment reason', () => {
  const input = { version: 1, ownerId: '00000000-0000-4000-8000-000000000001' };
  it.each([{}, { reason: '' }, { reason: '   ' }])(
    'accepts an empty reason: %j',
    (reason) => {
      const dto = plainToInstance(AssignChatDto, { ...input, ...reason });
      expect(validateSync(dto)).toHaveLength(0);
      expect(dto.reason).toBe('');
    },
  );
  it('trims supplied reasons and preserves the 2000 character limit', () => {
    const dto = plainToInstance(AssignChatDto, {
      ...input,
      reason: '  note  ',
    });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.reason).toBe('note');
    for (const reason of ['x'.repeat(2001), null, 123]) {
      expect(
        validateSync(plainToInstance(AssignChatDto, { ...input, reason })),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'reason' }),
        ]),
      );
    }
  });
});
