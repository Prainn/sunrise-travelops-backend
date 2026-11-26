import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MAILBOX,
  MailAddress,
  headerIds,
  readableText,
  replyBody,
} from './mail.types';

const ORIGIN = 'https://alimail-cn.aliyuncs.com';
const mailboxPath = (mailbox: string) =>
  '/v2/users/' + encodeURIComponent(mailbox);
export class AliMailError extends Error {
  constructor(readonly status: number) {
    super('ALI_MAIL_HTTP_' + status);
  }
}
interface AliMessage {
  id: string;
  internetMessageId?: string;
  internetMessageHeaders?: Record<string, string>;
  from?: MailAddress;
  replyTo?: MailAddress[];
  toRecipients?: MailAddress[];
  ccRecipients?: MailAddress[];
  isRead?: boolean;
  hasAttachments?: boolean;
  subject?: string;
  sentDateTime?: string;
  receivedDateTime?: string;
  body?: { bodyText?: string; bodyHtml?: string };
}
export interface RemoteMail {
  providerId: string;
  internetId: string | null;
  refs: string[];
  marker?: string;
  subject: string;
  sender: MailAddress;
  recipients: MailAddress[];
  cc: MailAddress[];
  replyTo: MailAddress[];
  body: string;
  occurredAt: Date;
  isRead: boolean;
  attachments: { id: string; name: string; size: number }[];
}
export interface OutgoingMail {
  mailbox: string;
  id: string;
  parent: string;
  references: string[];
  subject: string;
  name: string;
  to: MailAddress[];
  cc: MailAddress[];
  body: string;
}
@Injectable()
export class AliMailProvider {
  private cached?: { token: string; until: number };
  constructor(private readonly config: ConfigService) {}
  get enabled() {
    return this.config.get<string>('ALIMAIL_ENABLED') === 'true';
  }
  get startAt() {
    return this.config.get<string>('ALIMAIL_SYNC_FROM') || undefined;
  }
  private async token() {
    if (!this.enabled) throw new Error('ALI_MAIL_DISABLED');
    if (this.cached && this.cached.until > Date.now()) return this.cached.token;
    const response = await fetch(ORIGIN + '/oauth2/v2.0/token', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.getOrThrow<string>('ALIMAIL_CLIENT_ID'),
        client_secret: this.config.getOrThrow<string>('ALIMAIL_CLIENT_SECRET'),
      }),
    });
    if (!response.ok) throw new AliMailError(response.status);
    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    if (!data.access_token) throw new Error('ALI_MAIL_TOKEN_MISSING');
    this.cached = {
      token: data.access_token,
      until: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000,
    };
    return data.access_token;
  }
  private async api(path: string, method = 'GET', body?: object | Buffer) {
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN || !url.pathname.startsWith('/v2/'))
      throw new Error('ALI_MAIL_PATH');
    const binary = Buffer.isBuffer(body);
    const response = await fetch(url, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(60000),
      headers: {
        authorization: 'Bearer ' + (await this.token()),
        ...(body
          ? {
              'content-type': binary
                ? 'application/octet-stream'
                : 'application/json',
            }
          : {}),
      },
      body: binary
        ? new Uint8Array(body)
        : body
          ? JSON.stringify(body)
          : undefined,
    });
    if (response.status === 401) this.cached = undefined;
    return response;
  }
  private async json<T>(
    path: string,
    method = 'GET',
    body?: object,
  ): Promise<T> {
    const r = await this.api(path, method, body);
    if (!r.ok) throw new AliMailError(r.status);
    return (await r.json()) as T;
  }
  list(folder: string, start: Date, end: Date, cursor?: string | null) {
    const query = new URLSearchParams({
      size: '40',
      isAscending: 'true',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });
    if (cursor) query.set('cursor', cursor);
    return this.json<{
      messages?: { id: string }[];
      hasMore: boolean;
      nextCursor?: string;
    }>(
      mailboxPath(MAILBOX) +
        '/mailFolders/' +
        folder +
        '/messages?' +
        query.toString(),
    );
  }
  private messagePath(mailbox: string, id: string) {
    return mailboxPath(mailbox) + '/messages/' + encodeURIComponent(id);
  }
  async message(id: string, inbound: boolean): Promise<RemoteMail> {
    const path = this.messagePath(MAILBOX, id);
    const base = (await this.json<{ message: AliMessage }>(path)).message;
    // This tenant rejects comma-separated projections. Fetch optional fields individually.
    const fields: (keyof AliMessage)[] = [
      'from',
      'subject',
      'isRead',
      'hasAttachments',
      'internetMessageId',
      'internetMessageHeaders',
      'body',
      'toRecipients',
      'ccRecipients',
      'replyTo',
      inbound ? 'receivedDateTime' : 'sentDateTime',
    ];
    for (const key of fields) {
      if (base[key] !== undefined) continue;
      const data = await this.json<{ message: AliMessage }>(
        path + '?$select=' + key,
      );
      Object.assign(base, { [key]: data.message[key] });
    }
    const headers = Object.fromEntries(
      Object.entries(base.internetMessageHeaders ?? {}).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const received = inbound ? base.receivedDateTime : base.sentDateTime;
    const occurredAt = new Date(received ?? '');
    if (!Number.isFinite(occurredAt.getTime()) || !base.from?.email)
      throw new Error('ALI_MAIL_INCOMPLETE_MESSAGE');
    const attachments =
      (
        await this.json<{ attachments?: RemoteMail['attachments'] }>(
          path + '/attachments',
        )
      ).attachments ?? [];
    return {
      providerId: id,
      internetId:
        headerIds(base.internetMessageId ?? headers['message-id'])[0] ?? null,
      refs: [
        ...new Set([
          ...headerIds(headers.references),
          ...headerIds(headers['in-reply-to']),
        ]),
      ],
      marker:
        headers['x-travelops-reply'] ||
        /<!--travelops-reply:([a-f0-9-]{36})-->/.exec(
          base.body?.bodyHtml ?? '',
        )?.[1],
      subject: base.subject ?? '',
      sender: base.from,
      recipients: base.toRecipients ?? [],
      cc: base.ccRecipients ?? [],
      replyTo: base.replyTo ?? [],
      body: readableText(base.body),
      occurredAt,
      isRead: !!base.isRead,
      attachments,
    };
  }
  async createReply(input: OutgoingMail) {
    const body = replyBody(input.body, input.name);
    body.bodyHtml += '<!--travelops-reply:' + input.id + '-->';
    const references = [...new Set([...input.references, input.parent])]
      .map((x) => '<' + x + '>')
      .join(' ');
    const data = await this.json<{ message: { id: string } }>(
      mailboxPath(input.mailbox) + '/messages',
      'POST',
      {
        message: {
          from: { email: input.mailbox },
          toRecipients: input.to,
          ccRecipients: input.cc,
          subject: input.subject,
          internetMessageId: `<${input.id}@lynxtour.cn>`,
          body,
          internetMessageHeaders: {
            'In-Reply-To': '<' + input.parent + '>',
            References: references,
            'X-TravelOps-Reply': input.id,
          },
        },
      },
    );
    if (!data.message?.id) throw new Error('ALI_MAIL_DRAFT_MISSING');
    const id = data.message.id;
    const saved = await this.json<{ message: AliMessage }>(
      this.messagePath(input.mailbox, id) + '?$select=internetMessageId',
    );
    return {
      id,
      internetId:
        headerIds(saved.message.internetMessageId)[0] ??
        input.id + '@lynxtour.cn',
    };
  }
  async upload(mailbox: string, id: string, name: string, bytes: Buffer) {
    const types: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
    };
    const contentType =
      types[name.split('.').at(-1)?.toLowerCase() ?? ''] ??
      'application/octet-stream';
    const { uploadUrl } = await this.json<{ uploadUrl: string }>(
      this.messagePath(mailbox, id) + '/attachments/createUploadSession',
      'POST',
      { attachment: { name, contentType, isInline: false } },
    );
    const url = new URL(uploadUrl, ORIGIN);
    if (url.origin !== ORIGIN || !url.pathname.startsWith('/v2/stream/'))
      throw new Error('ALI_MAIL_UPLOAD_URL');
    const response = await this.api(url.href, 'POST', bytes);
    if (!response.ok) throw new AliMailError(response.status);
  }
  async send(mailbox: string, id: string) {
    const r = await this.api(this.messagePath(mailbox, id) + '/send', 'POST', {
      saveToSentItems: true,
    });
    if (!r.ok) throw new AliMailError(r.status);
  }
  async download(mailbox: string, messageId: string, fileId: string) {
    const r = await this.api(
      this.messagePath(mailbox, messageId) +
        '/attachments/' +
        encodeURIComponent(fileId) +
        '/$value',
    );
    if (r.ok) return r;
    // The download endpoint can redirect to a signed provider URL. Do not forward the OAuth token.
    const location = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && location) {
      const u = new URL(location, ORIGIN);
      if (
        u.protocol !== 'https:' ||
        !/(^|\.)(aliyuncs\.com|aliyun\.com)$/.test(u.hostname)
      )
        throw new Error('ALI_MAIL_DOWNLOAD_URL');
      const download =
        u.origin === ORIGIN
          ? await this.api(u.href)
          : await fetch(u, {
              redirect: 'error',
              signal: AbortSignal.timeout(60000),
            });
      if (download.ok) return download;
      throw new AliMailError(download.status);
    }
    throw new AliMailError(r.status);
  }
}
