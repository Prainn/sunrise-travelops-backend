import { Injectable } from '@nestjs/common';
import { request } from 'node:http';
import Cams, { SendChatappMessageRequest } from '@alicloud/cams20200606';
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
  async send(
    account: ChatAccount,
    recipient: string,
    text: string,
    taskId: string,
    reaction?: { messageId: string; emoji: string },
    contextMessageId?: string,
  ): Promise<SendResult> {
    this.config.assertSend(recipient);
    const socketPath = this.config.get('SEND_SOCKET');
    if (socketPath)
      return this.sendViaSocket(socketPath, {
        recipient,
        text,
        taskId,
        ...(reaction ? { reaction } : {}),
        ...(contextMessageId ? { contextMessageId } : {}),
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
          messageType: reaction ? 'reaction' : 'text',
          custSpaceId: account.spaceId,
          from: account.phone,
          to: recipient,
          content: JSON.stringify(reaction ?? { text }),
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
