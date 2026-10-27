import { ConfigService } from '@nestjs/config';
import { FeishuService } from './feishu.service';

describe('Feishu API transport', () => {
  const sender = () =>
    new FeishuService(
      new ConfigService({
        FEISHU_APP_ID: 'test-app',
        FEISHU_APP_SECRET: 'test-secret',
        FEISHU_WEB_BASE_URL: 'https://example.test',
      }),
    );
  afterEach(() => jest.restoreAllMocks());

  it('caches a tenant token and sends application-scoped open_id with stable UUID', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            tenant_access_token: 'test-token',
            expire: 7200,
          }),
        ),
      )
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ code: 0, data: { message_id: 'message' } }),
          ),
        ),
      );
    const service = sender();
    expect(await service.sendText('ou_test', 'hello', 'same-uuid')).toEqual({
      messageId: 'message',
    });
    await service.sendText('ou_test', 'hello', 'same-uuid');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, request] = fetchMock.mock.calls[1];
    expect(url).toBe(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
    );
    expect(JSON.parse(request?.body as string)).toEqual({
      receive_id: 'ou_test',
      msg_type: 'text',
      content: '{"text":"hello"}',
      uuid: 'same-uuid',
    });
    expect(request?.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer test-token' }),
    );
    expect(service.ledgerUrl('website', 'WEB 1')).toBe(
      'https://example.test/data-ledgers/website?keyword=WEB+1',
    );
  });

  it('rejects unconfigured sends before network access and never exposes provider errors', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    await expect(
      new FeishuService(new ConfigService({})).sendText('ou_test', 'hi', 'id'),
    ).rejects.toMatchObject({ response: { code: 'FEISHU_NOT_CONFIGURED' } });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ code: 1, msg: 'provider-sensitive-value' }),
      ),
    );
    await expect(
      sender().sendText('ou_test', 'hi', 'id'),
    ).rejects.toMatchObject({ response: { code: 'FEISHU_SEND_FAILED' } });
  });
});
