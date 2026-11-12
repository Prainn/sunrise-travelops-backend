import { Injectable } from '@nestjs/common';
import { request } from 'node:http';
import Cams, {
  SendChatappMessageRequest,
  ListChatappMessageRequest,
} from '@alicloud/cams20200606';
import Credentials from '@alicloud/credentials';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import { RuntimeOptions } from '@darabonba/typescript';
import { ChatAccount } from './whatsapp.types';
import { WhatsappConfig } from './whatsapp.config';
export type SendResult =
  | { status: 'accepted'; providerId: string }
  | { status: 'failed' | 'unknown'; errorCode: string };
@Injectable()
export class WhatsappProvider {
  constructor(private readonly config: WhatsappConfig) {}
  async reactionTarget(
    account: ChatAccount,
    providerId: string,
    occurredAt: Date,
  ): Promise<string | null> {
    const socketPath = this.config.get('SEND_SOCKET');
    if (socketPath) {
      return new Promise((resolve) => {
        const req = request(
          {
            socketPath,
            path: '/message-id',
            method: 'POST',
            headers: { 'content-type': 'application/json' },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString('utf8');
              if (data.length > 8192) res.destroy();
            });
            res.on('error', () => resolve(null));
            res.on('end', () => {
              try {
                const value = JSON.parse(data) as {
                  found?: boolean;
                  messageId?: string;
                };
                resolve(
                  res.statusCode === 200 &&
                    value.found &&
                    typeof value.messageId === 'string' &&
                    /^wamid\.[A-Za-z0-9+/=_-]+$/.test(value.messageId)
                    ? value.messageId
                    : null,
                );
              } catch {
                resolve(null);
              }
            });
          },
        );
        req.setTimeout(18000, () => req.destroy());
        req.on('error', () => resolve(null));
        req.end(
          JSON.stringify({
            providerId,
            occurredAt: new Date(occurredAt).getTime(),
          }),
        );
      });
    }
    const client = new Cams(
      new $OpenApiUtil.Config({
        credential: new Credentials(),
        endpoint: 'cams.ap-southeast-1.aliyuncs.com',
      }),
    );
    try {
      for (let index = 1; index <= 3; index++) {
        const result = await client.listChatappMessageWithOptions(
          new ListChatappMessageRequest({
            channelType: 'WHATSAPP',
            custSpaceId: account.spaceId,
            businessNumber: account.phone,
            startTime: new Date(occurredAt).getTime() - 60000,
            endTime: new Date(occurredAt).getTime() + 60000,
            page: { index, size: 100 },
          }),
          new RuntimeOptions({
            autoretry: false,
            maxAttempts: 1,
            connectTimeout: 2000,
            readTimeout: 3000,
          }),
        );
        if (result.body?.code !== 'OK') return null;
        const rows = result.body.data ?? [];
        const matched = rows.find(
          (row) =>
            row.messageId === providerId &&
            row.businessNumber === account.phone,
        );
        if (matched)
          return matched.uniqueMessageId &&
            /^wamid\.[A-Za-z0-9+/=_-]+$/.test(matched.uniqueMessageId)
            ? matched.uniqueMessageId
            : null;
        if (rows.length < 100) break;
      }
    } catch {
      return null;
    }
    return null;
  }
  async send(
    account: ChatAccount,
    recipient: string,
    text: string,
    taskId: string,
    reaction?: { messageId: string; emoji: string },
    contextMessageId?: string,
    image?: { link: string; caption: string },
  ): Promise<SendResult> {
    this.config.assertSend(recipient);
    if (reaction && !/^wamid\.[A-Za-z0-9+/=_-]+$/.test(reaction.messageId))
      return { status: 'failed', errorCode: 'REACTION_TARGET_UNAVAILABLE' };
    const socketPath = this.config.get('SEND_SOCKET');
    if (socketPath)
      return this.sendViaSocket(socketPath, {
        recipient,
        text,
        taskId,
        ...(reaction ? { reaction } : {}),
        ...(contextMessageId ? { contextMessageId } : {}),
        ...(image ? { image } : {}),
      });
    // Construct only on an authorized send; no credential resolution/network at module import.
    const client = new Cams(
      new $OpenApiUtil.Config({
        credential: new Credentials(),
        endpoint: 'cams.ap-southeast-1.aliyuncs.com',
      }),
    );
    try {
      const result = await client.sendChatappMessageWithOptions(
        new SendChatappMessageRequest({
          channelType: 'whatsapp',
          type: 'message',
          messageType: reaction ? 'reaction' : image ? 'image' : 'text',
          custSpaceId: account.spaceId,
          from: account.phone,
          to: recipient,
          content: JSON.stringify(reaction ?? image ?? { text }),
          taskId,
          contextMessageId,
        }),
        new RuntimeOptions({
          autoretry: false,
          maxAttempts: 1,
          connectTimeout: 5000,
          readTimeout: 10000,
        }),
      );
      if (result.body?.code === 'OK' && result.body.messageId)
        return { status: 'accepted', providerId: result.body.messageId };
      // A structured negative response is definite; transport exceptions are ambiguous.
      if (result.body?.code && result.body.code !== 'OK')
        return { status: 'failed', errorCode: 'PROVIDER_REJECTED' };
      return { status: 'unknown', errorCode: 'PROVIDER_RESULT_UNKNOWN' };
    } catch {
      return { status: 'unknown', errorCode: 'PROVIDER_RESULT_UNKNOWN' };
    }
  }
  private sendViaSocket(
    socketPath: string,
    body: Record<string, unknown>,
  ): Promise<SendResult> {
    return new Promise((resolve) => {
      const unknown: SendResult = {
        status: 'unknown',
        errorCode: 'PROVIDER_RESULT_UNKNOWN',
      };
      const req = request(
        {
          socketPath,
          method: 'POST',
          path: '/send',
          headers: { 'content-type': 'application/json' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString('utf8');
            if (data.length > 8192) res.destroy();
          });
          res.on('error', () => resolve(unknown));
          res.on('end', () => {
            try {
              const value = JSON.parse(data) as Record<string, unknown>;
              if (
                res.statusCode === 200 &&
                value.status === 'accepted' &&
                typeof value.providerId === 'string' &&
                value.providerId.length > 0
              )
                resolve({ status: 'accepted', providerId: value.providerId });
              else if (res.statusCode === 200 && value.status === 'failed')
                resolve({ status: 'failed', errorCode: 'PROVIDER_REJECTED' });
              else resolve(unknown);
            } catch {
              resolve(unknown);
            }
          });
        },
      );
      req.setTimeout(18000, () => req.destroy());
      req.on('error', () => resolve(unknown));
      req.end(JSON.stringify(body));
    });
  }
}
