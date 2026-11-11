import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../common/exceptions/business.exception';

interface TokenResponse {
  code: number;
  tenant_access_token?: string;
  expire?: number;
}
interface MessageResponse {
  code: number;
  data?: { message_id?: string };
}

export class FeishuSendException extends BusinessException {
  constructor(readonly deliveryUnknown: boolean) {
    super({
      code: 'FEISHU_SEND_FAILED',
      message: '飞书发送失败，请检查应用配置、权限、可用范围及 Open ID',
      status: HttpStatus.BAD_GATEWAY,
    });
  }
}

@Injectable()
export class FeishuService {
  private token?: { value: string; expiresAt: number };
  private tokenRequest?: Promise<string>;
  constructor(private readonly config: ConfigService) {}

  get configured() {
    return Boolean(
      this.config.get<string>('FEISHU_APP_ID')?.trim() &&
      this.config.get<string>('FEISHU_APP_SECRET')?.trim() &&
      this.config.get<string>('FEISHU_WEB_BASE_URL')?.trim(),
    );
  }

  ledgerUrl(
    unit: 'linxi' | 'website',
    orderNo: string,
    ledgerId?: string,
    action?: 'review' | 'operate',
  ) {
    const base = this.config.getOrThrow<string>('FEISHU_WEB_BASE_URL');
    const url = new URL(
      `/data-ledgers/${unit === 'linxi' ? 'direct' : 'website'}`,
      base,
    );
    url.searchParams.set('keyword', orderNo);
    if (ledgerId) {
      url.searchParams.set('ledgerId', ledgerId);
      url.searchParams.set('highlight', '1');
      url.searchParams.set('from', 'feishu');
    }
    if (action) url.searchParams.set('action', action);
    return url.toString();
  }

  conversationUrl(conversationId: string) {
    const url = new URL(
      '/whatsapp/inbox',
      this.config.getOrThrow<string>('FEISHU_WEB_BASE_URL'),
    );
    url.searchParams.set('conversationId', conversationId);
    url.searchParams.set('from', 'feishu');
    return url.toString();
  }

  private async request<T>(
    path: string,
    body: object,
    token?: string,
  ): Promise<T> {
    const response = await fetch(`https://open.feishu.cn/open-apis/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Feishu HTTP failure');
    return (await response.json()) as T;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now())
      return this.token.value;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = (async () => {
      const response = await this.request<TokenResponse>(
        'auth/v3/tenant_access_token/internal',
        {
          app_id: this.config.get<string>('FEISHU_APP_ID'),
          app_secret: this.config.get<string>('FEISHU_APP_SECRET'),
        },
      );
      if (
        response.code !== 0 ||
        !response.tenant_access_token ||
        !response.expire
      )
        throw new Error('Feishu token failure');
      this.token = {
        value: response.tenant_access_token,
        expiresAt: Date.now() + Math.max(0, response.expire - 120) * 1000,
      };
      return this.token.value;
    })();
    try {
      return await this.tokenRequest;
    } finally {
      this.tokenRequest = undefined;
    }
  }

  async sendText(openId: string, text: string, uuid: string) {
    if (!this.configured)
      throw new BusinessException({
        code: 'FEISHU_NOT_CONFIGURED',
        message: '飞书应用尚未配置',
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    let deliveryUnknown = false;
    try {
      const token = await this.accessToken();
      deliveryUnknown = true;
      const response = await this.request<MessageResponse>(
        'im/v1/messages?receive_id_type=open_id',
        {
          receive_id: openId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
          uuid,
        },
        token,
      );
      if (typeof response.code === 'number' && response.code !== 0)
        deliveryUnknown = false;
      if (response.code !== 0 || !response.data?.message_id) {
        // Retry queued messages with a fresh token; never log provider payloads.
        if ([99991663, 99991664, 99991668].includes(response.code))
          this.token = undefined;
        throw new Error('Feishu message failure');
      }
      return { messageId: response.data.message_id };
    } catch {
      throw new FeishuSendException(deliveryUnknown);
    }
  }
}
