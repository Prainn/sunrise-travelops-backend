import { Injectable } from '@nestjs/common';
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
  ): Promise<SendResult> {
    this.config.assertSend(recipient);
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
          messageType: 'text',
          custSpaceId: account.spaceId,
          from: account.phone,
          to: recipient,
          content: JSON.stringify({ text }),
          taskId,
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
}
