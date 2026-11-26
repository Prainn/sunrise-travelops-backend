import { ConfigService } from '@nestjs/config';
import { AliMailProvider } from './alimail.provider';
import { MAILBOX, replyBody } from './mail.types';

describe('AliMail mailbox contract', () => {
  const requestUrl = (input: Parameters<typeof fetch>[0]) =>
    new URL(input instanceof Request ? input.url : input);
  const json = (value: unknown) => new Response(JSON.stringify(value));
  const config = new ConfigService({
    ALIMAIL_ENABLED: 'true',
    ALIMAIL_CLIENT_ID: 'test',
    ALIMAIL_CLIENT_SECRET: 'fixture',
  });
  afterEach(() => jest.restoreAllMocks());
  it('reads individual optional projections and inline attachments without marking the inbox read', async () => {
    const selected: string[] = [];
    const full: Record<string, unknown> = {
      internetMessageId: '<incoming@example.test>',
      internetMessageHeaders: { 'In-Reply-To': '<parent@example.test>' },
      body: { bodyHtml: '<p>First</p><p>Second &amp; last</p>' },
      toRecipients: [{ email: MAILBOX }],
      ccRecipients: [],
      replyTo: [],
      receivedDateTime: '2026-11-26T01:02:03Z',
    };
    const http = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => {
        const url = requestUrl(input);
        let response: Response;
        if (url.pathname.endsWith('/token'))
          response = json({ access_token: 'fixture', expires_in: 3600 });
        else {
          expect(init?.method).toBe('GET');
          if (url.pathname.endsWith('/attachments'))
            response = json({
              attachments: [{ id: 'inline', name: 'photo.png', size: 10 }],
            });
          else if (url.searchParams.has('$select')) {
            const key = url.searchParams.get('$select')!;
            selected.push(key);
            expect(key).not.toContain(',');
            response = json({ message: { [key]: full[key] } });
          } else
            response = json({
              message: {
                id: 'provider',
                from: { email: 'sender@example.test' },
                subject: 'Trip',
                hasAttachments: false,
                isRead: false,
              },
            });
        }
        return Promise.resolve(response);
      });
    const mail = await new AliMailProvider(config).message('provider', true);
    expect(mail.refs).toEqual(['parent@example.test']);
    expect(mail.body).toBe('First\nSecond & last');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.isRead).toBe(false);
    expect(selected).toContain('receivedDateTime');
    expect(
      http.mock.calls.filter(([url]) =>
        requestUrl(url).pathname.endsWith('/token'),
      ),
    ).toHaveLength(1);
  });
  it('sends one original reply with a signed plain and HTML body plus a binary attachment', async () => {
    const payloads: Record<string, unknown>[] = [];
    let uploaded: Uint8Array | undefined;
    const http = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input, init) => {
        const url = requestUrl(input);
        let response: Response;
        if (url.pathname.endsWith('/token'))
          response = json({ access_token: 'fixture', expires_in: 3600 });
        else if (url.pathname.endsWith('/v2/stream/attachment')) {
          uploaded = init?.body as Uint8Array;
          response = json({});
        } else if (init?.method === 'GET')
          response = json({
            message: { internetMessageId: '<provider-assigned@example.test>' },
          });
        else {
          payloads.push(
            JSON.parse(
              typeof init?.body === 'string' ? init.body : 'null',
            ) as Record<string, unknown>,
          );
          response = json(
            url.pathname.endsWith('/createUploadSession')
              ? { uploadUrl: '/v2/stream/attachment' }
              : { message: { id: 'draft' } },
          );
        }
        return Promise.resolve(response);
      });
    const provider = new AliMailProvider(config);
    const remote = await provider.createReply({
      mailbox: 'groups@example.test',
      id: 'reply-1',
      parent: 'parent@example.test',
      references: ['root@example.test'],
      subject: 'Re: Trip',
      name: 'Taylor',
      to: [{ email: 'customer@example.test' }],
      cc: [],
      body: 'Two < three',
    });
    expect(remote.internetId).toBe('provider-assigned@example.test');
    const bytes = Buffer.from('pdf bytes');
    await provider.upload('groups@example.test', remote.id, 'quote.pdf', bytes);
    await provider.send('groups@example.test', remote.id);
    expect(Buffer.from(uploaded!)).toEqual(bytes);
    expect(payloads[0]).toMatchObject({
      message: {
        from: { email: 'groups@example.test' },
        internetMessageHeaders: {
          'In-Reply-To': '<parent@example.test>',
          References: '<root@example.test> <parent@example.test>',
        },
        body: {
          bodyText:
            'Two < three\n\nBest regards,\n\nTaylor\nTravel Consultant\nLynxtour\nWhatsapp: +8613211685553\nEmail: biz@lynxtour.cn\nWebsite: https://lynxtour.cn/',
        },
      },
    });
    const message = payloads[0].message as { body: { bodyHtml: string } };
    expect(message.body.bodyHtml).toContain('Two &lt; three');
    expect(replyBody('Hi', 'Taylor').bodyHtml).toContain(
      '<a href="mailto:biz@lynxtour.cn">',
    );
    expect(payloads[1]).toEqual({
      attachment: {
        name: 'quote.pdf',
        contentType: 'application/pdf',
        isInline: false,
      },
    });
    expect(payloads[2]).toEqual({ saveToSentItems: true });
    for (const [url] of http.mock.calls) {
      const pathname = requestUrl(url).pathname;
      if (pathname.startsWith('/v2/users/'))
        expect(pathname).toMatch(/^\/v2\/users\/groups%40example\.test\//);
    }
    expect(
      http.mock.calls.filter(([url]) =>
        requestUrl(url).pathname.endsWith('/send'),
      ),
    ).toHaveLength(1);
  });
});
