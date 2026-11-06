import Cams, {
  SendChatappMessageResponse,
  SendChatappMessageResponseBody,
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
