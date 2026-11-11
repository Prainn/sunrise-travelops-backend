import { Injectable } from '@nestjs/common';
import OpenApi, { Config, OpenApiRequest } from '@alicloud/openapi-client';
import Credentials from '@alicloud/credentials';
import { RuntimeOptions } from '@alicloud/tea-util';
import { WhatsappConfig } from './whatsapp.config';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// The ChatApp inter SDK uses Shanghai time, not the host's local timezone.
function expirationTime(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
  )
    throw new Error('QUEUE_CREDENTIAL_EXPIRED');
  const expiration = Date.parse(`${value.replace(' ', 'T')}+08:00`);
  if (
    !Number.isFinite(expiration) ||
    new Date(expiration + 8 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ') !== value ||
    expiration <= Date.now() + 60000
  )
    throw new Error('QUEUE_CREDENTIAL_EXPIRED');
  return expiration;
}

@Injectable()
export class WhatsappQueueToken {
  constructor(private readonly config: WhatsappConfig) {}

  async get(kind: 'inbound' | 'status') {
    // Generic official RPC transport preserves STS and HMAC-SHA1 signing.
    // The generated dybaseapi20170525 client targets the wrong ChatApp API version.
    const client = new OpenApi(
      new Config({
        credential: new Credentials(),
        endpoint: new URL(this.config.get('TOKEN_ENDPOINT')).host,
      }),
    );
    const response = await client.doRPCRequest(
      'QueryTokenForMnsQueue',
      '2018-05-01',
      'HTTPS',
      'POST',
      'AK',
      'json',
      new OpenApiRequest({
        query: {
          MessageType: kind === 'inbound' ? 'ChatAppInbound' : 'ChatAppStatus',
        },
      }),
      new RuntimeOptions({
        autoretry: false,
        maxAttempts: 1,
        connectTimeout: 5000,
        readTimeout: 10000,
      }),
    );
    const body = record(response.body);
    const token = record(body.MessageTokenDTO);
    const { AccessKeyId, AccessKeySecret, SecurityToken } = token;
    if (
      body.Code !== 'OK' ||
      typeof AccessKeyId !== 'string' ||
      !AccessKeyId ||
      typeof AccessKeySecret !== 'string' ||
      !AccessKeySecret ||
      typeof SecurityToken !== 'string' ||
      !SecurityToken
    )
      throw new Error('QUEUE_CREDENTIAL_UNAVAILABLE');
    return {
      accessKeyId: AccessKeyId,
      accessKeySecret: AccessKeySecret,
      securityToken: SecurityToken,
      expiresAt: expirationTime(token.ExpireTime),
    };
  }
}
