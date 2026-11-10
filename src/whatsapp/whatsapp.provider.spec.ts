import Cams, {
  SendChatappMessageResponse,
  SendChatappMessageResponseBody,
  ListChatappMessageResponse,
  ListChatappMessageResponseBody,
} from '@alicloud/cams20200606';
import { ConfigService } from '@nestjs/config';
import { WhatsappConfig } from './whatsapp.config';
import { WhatsappProvider } from './whatsapp.provider';

// No credentials resolution or network: the official SDK transport is intercepted.
jest.mock('@alicloud/credentials', () => ({
  __esModule: true,
  default: jest.fn(),
}));
describe('WhatsApp official SDK adapter', () => {
  const config = new WhatsappConfig(
    new ConfigService({
      WHATSAPP_CHAT_ENABLED: 'true',
      WHATSAPP_CHAT_SEND_ENABLED: 'true',
      WHATSAPP_CHAT_SPACE_ID: 'synthetic-space',
      WHATSAPP_CHAT_WABA_ID: 'synthetic-waba',
      WHATSAPP_CHAT_PHONE: '0000000000',
      WHATSAPP_CHAT_TEST_RECIPIENTS: 'ZZ.synthetic',
    }),
  );
  const account = {
    id: 'synthetic',
    spaceId: 'synthetic-space',
    wabaId: 'synthetic-waba',
    phone: '0000000000',
  };
  const provider = new WhatsappProvider(config);
  afterEach(() => jest.restoreAllMocks());
  it('resolves the exact provider ID to its WhatsApp ID within the fixed business account', async () => {
    const send = jest.spyOn(Cams.prototype, 'sendChatappMessageWithOptions');
    const lookup = jest
      .spyOn(Cams.prototype, 'listChatappMessageWithOptions')
      .mockResolvedValue(
        new ListChatappMessageResponse({
          body: new ListChatappMessageResponseBody({
            code: 'OK',
            data: [
              {
                messageId: 'other',
                businessNumber: account.phone,
                uniqueMessageId: 'wamid.wrong',
              },
              {
                messageId: 'target',
                businessNumber: '0000000001',
                uniqueMessageId: 'wamid.wrong-account',
              },
              {
                messageId: 'target',
                businessNumber: account.phone,
                uniqueMessageId: 'wamid.correct',
              },
            ],
          }),
        }),
      );
    expect(await provider.reactionTarget(account, 'target', new Date())).toBe(
      'wamid.correct',
    );
    expect(lookup).toHaveBeenCalledWith(
      expect.objectContaining({
        businessNumber: account.phone,
        custSpaceId: account.spaceId,
        page: { index: 1, size: 100 },
      }),
      expect.objectContaining({ autoretry: false, maxAttempts: 1 }),
    );
    expect(send).not.toHaveBeenCalled();
  });
  it('does not guess a WhatsApp ID from numeric provider IDs or failed lookups', async () => {
    jest
      .spyOn(Cams.prototype, 'listChatappMessageWithOptions')
      .mockResolvedValue(
        new ListChatappMessageResponse({
          body: new ListChatappMessageResponseBody({
            code: 'OK',
            data: [
              {
                messageId: 'target',
                businessNumber: account.phone,
                uniqueMessageId: '12345',
              },
            ],
          }),
        }),
      );
    expect(
      await provider.reactionTarget(account, 'target', new Date()),
    ).toBeNull();
  });
  it('uses text content, BSUID and TaskId and disables transport retries', async () => {
    const transport = jest
      .spyOn(Cams.prototype, 'sendChatappMessageWithOptions')
      .mockResolvedValue(
        new SendChatappMessageResponse({
          body: new SendChatappMessageResponseBody({
            code: 'OK',
            messageId: 'synthetic-message',
          }),
        }),
      );
    expect(
      await provider.send(
        account,
        'ZZ.synthetic',
        'Synthetic text',
        'synthetic-task',
      ),
    ).toEqual({ status: 'accepted', providerId: 'synthetic-message' });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ZZ.synthetic',
        from: account.phone,
        custSpaceId: account.spaceId,
        content: '{"text":"Synthetic text"}',
        messageType: 'text',
        taskId: 'synthetic-task',
      }),
      expect.objectContaining({ autoretry: false, maxAttempts: 1 }),
    );
  });
  it('sends a reaction against the provider message ID, not as an emoji text message', async () => {
    const transport = jest
      .spyOn(Cams.prototype, 'sendChatappMessageWithOptions')
      .mockResolvedValue(
        new SendChatappMessageResponse({
          body: new SendChatappMessageResponseBody({
            code: 'OK',
            messageId: 'reaction-id',
          }),
        }),
      );
    await provider.send(account, 'ZZ.synthetic', '👍', 'task', {
      messageId: 'wamid.original-id',
      emoji: '👍',
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'reaction',
        content: '{"messageId":"wamid.original-id","emoji":"👍"}',
      }),
      expect.anything(),
    );
  });
  it('uses ContextMessageId for a native quoted text reply', async () => {
    const transport = jest
      .spyOn(Cams.prototype, 'sendChatappMessageWithOptions')
      .mockResolvedValue(
        new SendChatappMessageResponse({
          body: new SendChatappMessageResponseBody({
            code: 'OK',
            messageId: 'quoted-reply',
          }),
        }),
      );
    await provider.send(
      account,
      'ZZ.synthetic',
      '*hello*',
      'task',
      undefined,
      'original-provider-id',
    );
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'text',
        content: '{"text":"*hello*"}',
        contextMessageId: 'original-provider-id',
      }),
      expect.objectContaining({ autoretry: false, maxAttempts: 1 }),
    );
  });
  it.each([
    ['OK', 'unknown'],
    ['InvalidParameter', 'failed'],
  ])('classifies %s without MessageId as %s', async (code, status) => {
    jest
      .spyOn(Cams.prototype, 'sendChatappMessageWithOptions')
      .mockResolvedValue(
        new SendChatappMessageResponse({
          body: new SendChatappMessageResponseBody({ code }),
        }),
      );
    expect(
      (await provider.send(account, 'ZZ.synthetic', 'Synthetic', 'task'))
        .status,
    ).toBe(status);
  });
  it('suppresses sensitive transport errors and treats timeouts as ambiguous', async () => {
    jest
      .spyOn(Cams.prototype, 'sendChatappMessageWithOptions')
      .mockRejectedValue(new Error('synthetic-secret-and-payload'));
    expect(
      await provider.send(account, 'ZZ.synthetic', 'Synthetic', 'task'),
    ).toEqual({ status: 'unknown', errorCode: 'PROVIDER_RESULT_UNKNOWN' });
  });
  it('does not call the SDK for an unauthorized test recipient', async () => {
    const transport = jest.spyOn(
      Cams.prototype,
      'sendChatappMessageWithOptions',
    );
    await expect(
      provider.send(account, 'ZZ.other', 'Synthetic', 'task'),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
