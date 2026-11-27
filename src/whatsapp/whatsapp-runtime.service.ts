import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  integrationEnvironment,
  UpdateIntegrationRuntimeDto,
} from '../common/integration-runtime';
import { WhatsappConfig } from './whatsapp.config';
import { chatFail } from './whatsapp.policy';
import { notifyWhatsappChange } from './whatsapp-changes';

type RuntimeRow = {
  inbound_enabled: boolean;
  outbound_enabled: boolean;
  version: number;
};

@Injectable()
export class WhatsappRuntime {
  constructor(
    private readonly db: DataSource,
    private readonly whatsapp: WhatsappConfig,
    private readonly config: ConfigService,
  ) {}

  private availability() {
    return {
      inboundAvailable:
        this.whatsapp.enabled && ['http', 'queue'].includes(this.whatsapp.mode),
      outboundAvailable:
        this.whatsapp.enabled && this.whatsapp.get('SEND_ENABLED') === 'true',
    };
  }

  private present(row: RuntimeRow) {
    const environment = integrationEnvironment(
      this.config.get<string>('DATABASE_NAME'),
    );
    const availability = this.availability();
    return {
      environment,
      version: row.version,
      ...availability,
      inboundEnabled: availability.inboundAvailable && row.inbound_enabled,
      outboundEnabled: availability.outboundAvailable && row.outbound_enabled,
    };
  }

  async state(manager = this.db.manager, lock = false) {
    const [row] = await manager.query<RuntimeRow[]>(
      'SELECT inbound_enabled,outbound_enabled,version FROM whatsapp_runtime_settings WHERE id=1' +
        (lock ? ' FOR SHARE' : ''),
    );
    if (!row) throw new Error('WHATSAPP_RUNTIME_NOT_INITIALIZED');
    return this.present(row);
  }

  async update(input: UpdateIntegrationRuntimeDto) {
    const { inboundAvailable, outboundAvailable } = this.availability();
    if (
      input.inboundEnabled === undefined &&
      input.outboundEnabled === undefined
    )
      chatFail('VALIDATION_ERROR', '请选择要修改的开关', 400);
    if (
      (input.inboundEnabled === true && !inboundAvailable) ||
      (input.outboundEnabled === true && !outboundAvailable)
    )
      chatFail('CONFLICT', '当前环境的基础接入配置不允许启用该开关', 409);
    return this.db.transaction(async (manager) => {
      const [[row]] = await manager.query<[RuntimeRow[], number]>(
        `UPDATE whatsapp_runtime_settings SET
          inbound_enabled=coalesce($2,inbound_enabled),outbound_enabled=coalesce($3,outbound_enabled),
          version=version+1,updated_at=now() WHERE id=1 AND version=$1
          RETURNING inbound_enabled,outbound_enabled,version`,
        [
          input.version,
          input.inboundEnabled ?? null,
          input.outboundEnabled ?? null,
        ],
      );
      if (!row) chatFail('CONFLICT', '开关状态已变化，请刷新后重试', 409);
      await notifyWhatsappChange(manager, { type: 'resync' });
      return this.present(row);
    });
  }
}
