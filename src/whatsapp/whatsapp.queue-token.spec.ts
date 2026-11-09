import OpenApi from '@alicloud/openapi-client';
import { ConfigService } from '@nestjs/config';
import { WhatsappConfig } from './whatsapp.config';
import { WhatsappQueueToken } from './whatsapp.queue-token';

jest.mock('@alicloud/credentials', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('ChatApp queue token adapter', () => {
  const config = new WhatsappConfig(
    new ConfigService({
      WHATSAPP_CHAT_TOKEN_ENDPOINT:
        'https://dybaseapi.ap-southeast-1.aliyuncs.com',
    }),
  );
  const tokens = new WhatsappQueueToken(config);
  function response(overrides: Record<string, unknown> = {}) {
    return {
      body: {
        Code: 'OK',
        MessageTokenDTO: {
          AccessKeyId: 'synthetic-id',
          AccessKeySecret: 'synthetic-secret',
          SecurityToken: 'synthetic-token',
          ExpireTime: '2026-11-09 17:28:41',
          ...overrides,
        },
      },
    };
  }
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-09T09:20:00Z'));
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['inbound', 'ChatAppInbound'],
    ['status', 'ChatAppStatus'],
  ] as const)(
    'uses the inter API for %s and parses Shanghai expiry',
    async (kind, messageType) => {
      const transport = jest
        .spyOn(OpenApi.prototype, 'doRPCRequest')
        .mockResolvedValue(response());
      await expect(tokens.get(kind)).resolves.toEqual({
        accessKeyId: 'synthetic-id',
        accessKeySecret: 'synthetic-secret',
        securityToken: 'synthetic-token',
        expiresAt: Date.parse('2026-11-09T09:28:41Z'),
      });
      expect(transport).toHaveBeenCalledWith(
        'QueryTokenForMnsQueue',
        '2018-05-01',
        'HTTPS',
        'POST',
        'AK',
        'json',
        expect.objectContaining({ query: { MessageType: messageType } }),
        expect.objectContaining({
          autoretry: false,
          maxAttempts: 1,
          connectTimeout: 5000,
          readTimeout: 10000,
        }),
      );
    },
  );

  it.each(['AccessKeyId', 'AccessKeySecret', 'SecurityToken'])(
    'rejects incomplete credentials without %s',
    async (field) => {
      jest
        .spyOn(OpenApi.prototype, 'doRPCRequest')
        .mockResolvedValue(response({ [field]: '' }));
      await expect(tokens.get('inbound')).rejects.toThrow(
        'QUEUE_CREDENTIAL_UNAVAILABLE',
      );
    },
  );

  it.each([
    undefined,
    'invalid',
    '2026-02-30 17:28:41',
    '2026-11-09 25:28:41',
    '2026-11-09 17:19:59',
    '2026-11-09 17:21:00',
  ])(
    'rejects malformed, expired or nearly expired credentials: %s',
    async (expiry) => {
      jest
        .spyOn(OpenApi.prototype, 'doRPCRequest')
        .mockResolvedValue(response({ ExpireTime: expiry }));
      await expect(tokens.get('status')).rejects.toThrow(
        'QUEUE_CREDENTIAL_EXPIRED',
      );
    },
  );

  it('does not mistake HTTP success or an unexpected response for credentials', async () => {
    const transport = jest.spyOn(OpenApi.prototype, 'doRPCRequest');
    for (const body of [
      {
        Code: 'isv.INVALID_PARAMETERS',
        Message: 'synthetic-sensitive-content',
      },
      { Code: 'OK' },
      null,
    ]) {
      transport.mockResolvedValue({ body });
      await expect(tokens.get('status')).rejects.toThrow(
        'QUEUE_CREDENTIAL_UNAVAILABLE',
      );
    }
  });
});
