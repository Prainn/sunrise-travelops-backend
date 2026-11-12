import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chatFail } from '../whatsapp/whatsapp.policy';

@Injectable()
export class MediaConfig {
  constructor(private readonly config: ConfigService) {}
  get enabled() {
    return this.config.get<string>('OSS_MEDIA_ENABLED') === 'true';
  }
  get environment(): 'dev' | 'prod' {
    const value = this.config.get<string>('OSS_MEDIA_ENVIRONMENT');
    if (value !== 'dev' && value !== 'prod')
      throw new Error('OSS_ENVIRONMENT_REQUIRED');
    return value;
  }
  get socket() {
    return this.config.get<string>('OSS_MEDIA_SOCKET') ?? '';
  }
  get publicOrigin() {
    return this.config.get<string>('OSS_MEDIA_PUBLIC_ORIGIN') ?? '';
  }
  assertEnabled() {
    if (!this.enabled || !this.socket)
      chatFail('CONFLICT', 'OSS媒体服务尚未配置', 409);
    void this.environment;
    if (this.publicOrigin) {
      const u = new URL(this.publicOrigin);
      if (
        u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        u.pathname !== '/' ||
        u.search ||
        u.hash
      )
        throw new Error('OSS_PUBLIC_ORIGIN_INVALID');
    }
  }
  url(key: string | null): string | null {
    if (!key || !this.publicOrigin) return null;
    if (!key.startsWith(this.environment + '/'))
      throw new Error('OSS_PREFIX_INVALID');
    return (
      this.publicOrigin.replace(/\/$/, '') +
      '/' +
      key.split('/').map(encodeURIComponent).join('/')
    );
  }
}
