import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { chatFail } from './whatsapp.policy';
@Injectable()
export class WhatsappConfig {
  constructor(private readonly config: ConfigService) {}
  get(key: string): string {
    return this.config.get<string>(`WHATSAPP_CHAT_${key}`)?.trim() ?? '';
  }
  get enabled() {
    return this.get('ENABLED') === 'true';
  }
  get workerEnabled() {
    return this.enabled && this.get('WORKER_ENABLED') === 'true';
  }
  get mode() {
    return this.get('RECEIVE_MODE') || 'disabled';
  }
  account() {
    const spaceId = this.get('SPACE_ID'),
      wabaId = this.get('WABA_ID'),
      phone = this.get('PHONE').replace(/^\+/, '');
    if (!this.enabled || !spaceId || !wabaId || !/^\d{5,20}$/.test(phone))
      chatFail('CONFLICT', 'WhatsApp接入尚未配置', 409);
    return { spaceId, wabaId, phone };
  }
  assertSend(recipient: string) {
    this.account();
    if (this.get('SEND_ENABLED') !== 'true')
      chatFail('CONFLICT', 'WhatsApp发送尚未启用', 409);
    // Defaults to test. Only an explicit production environment may omit the allowlist.
    if (
      this.get('ENVIRONMENT') !== 'production' &&
      !this.get('TEST_RECIPIENTS')
        .split(',')
        .map((x) => x.trim().replace(/^\+/, ''))
        .filter(Boolean)
        .includes(recipient)
    )
      chatFail('AUTH_FORBIDDEN', '测试环境只能向已授权测试对象发送', 403);
  }
  authorize(header: string | undefined, key: 'HTTP_TOKEN' | 'SOURCE_TOKEN') {
    const expected = this.get(key),
      actual = header?.startsWith('Bearer ') ? header.slice(7) : '';
    if (
      !this.enabled ||
      expected.length < 32 ||
      Buffer.byteLength(expected) !== Buffer.byteLength(actual) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
    )
      chatFail('AUTH_FORBIDDEN', '接入认证失败', 403);
  }
  validate() {
    if (!this.enabled) return;
    this.account();
    if (
      this.get('SEND_SOCKET') &&
      this.get('SEND_SOCKET') !== '/run/sunrise-whatsapp-send/send.sock'
    )
      throw new Error('Invalid WHATSAPP_CHAT_SEND_SOCKET');
    if (!['disabled', 'queue', 'http'].includes(this.mode))
      throw new Error('Invalid WHATSAPP_CHAT_RECEIVE_MODE');
    if (this.mode === 'http' && this.get('HTTP_TOKEN').length < 32)
      throw new Error('WHATSAPP_CHAT_HTTP_TOKEN requires 32 characters');
    if (this.mode === 'queue') {
      for (const key of [
        'MNS_ENDPOINT',
        'INBOUND_QUEUE',
        'STATUS_QUEUE',
        'TOKEN_ENDPOINT',
      ])
        if (!this.get(key)) throw new Error(`WHATSAPP_CHAT_${key} required`);
      for (const key of ['MNS_ENDPOINT', 'TOKEN_ENDPOINT']) {
        const url = new URL(this.get(key));
        if (
          url.protocol !== 'https:' ||
          !url.hostname.endsWith('.aliyuncs.com') ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== '/'
        )
          throw new Error(`Invalid WHATSAPP_CHAT_${key}`);
      }
      for (const key of ['INBOUND_QUEUE', 'STATUS_QUEUE'])
        if (!/^[A-Za-z0-9-]{1,256}$/.test(this.get(key)))
          throw new Error(`Invalid WHATSAPP_CHAT_${key}`);
    }
  }
}
