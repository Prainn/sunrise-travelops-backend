import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { BusinessException } from '../common/exceptions/business.exception';
import { FeishuService } from '../feishu/feishu.service';
import { UserEntity, UserStatus } from '../users/user.entity';
import { InspectionAlertDto } from './inspection-alert.dto';

const descriptions = {
  availability: ['服务可用性异常', '服务可能无法访问', '检查服务和依赖状态'],
  disk: [
    '磁盘使用率异常',
    '存储空间可能不足',
    '检查磁盘使用情况并安排清理或扩容',
  ],
  memory: [
    '内存使用率异常',
    '服务可能受到内存压力影响',
    '检查内存使用情况并安排处理',
  ],
  cpu: ['CPU 使用率异常', '服务响应可能变慢', '检查 CPU 使用情况并安排处理'],
} as const;

export function formatInspectionAlert(input: InspectionAlertDto): string {
  const [item, impact, advice] = descriptions[input.item];
  return `【巡检异常】\n检查时间：${new Date(input.checkedAt).toISOString()}（UTC）\n环境：${input.environment === 'production' ? '生产' : '开发'}\n异常项：${item}\n级别：${input.severity === 'critical' ? '严重' : '警告'}\n关键指标：${input.metricPercent}%\n影响：${impact}\n建议：${advice}`;
}

@Injectable()
export class InspectionAlertService {
  private readonly sent = new Map<string, number>();
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly feishu: FeishuService,
  ) {}

  async report(input: InspectionAlertDto): Promise<{ result: string }> {
    if (input.status !== 'abnormal') return { result: 'silent' };
    const key = `${input.environment}:${input.eventId.toLowerCase()}`;
    const level = input.severity === 'critical' ? 2 : 1;
    while (this.pending.has(key))
      await this.pending.get(key)!.catch(() => undefined);
    if ((this.sent.get(key) ?? 0) >= level) return { result: 'duplicate' };
    if (this.pending.size >= 100) {
      throw new BusinessException({
        code: 'INSPECTION_ALERT_UNAVAILABLE',
        message: '巡检通知繁忙，请稍后重试',
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }
    const task = this.send(input, key, level);
    this.pending.set(key, task);
    try {
      await task;
      return { result: 'sent' };
    } finally {
      this.pending.delete(key);
    }
  }

  private async send(
    input: InspectionAlertDto,
    key: string,
    level: number,
  ): Promise<void> {
    const id = this.config.get<string>('INSPECTION_ALERT_RECIPIENT_USER_ID');
    const user = await this.users.findOne({
      where: { id, status: UserStatus.Enabled },
      relations: { identities: true },
    });
    if (
      !user ||
      !user.feishuOpenId ||
      !user.identities.some((identity) => identity.scope === 'headquarters')
    ) {
      throw new BusinessException({
        code: 'INSPECTION_ALERT_UNAVAILABLE',
        message: '巡检通知接收账号不可用',
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }
    const uuid = createHash('sha256')
      .update(`inspection:${key}:${level}`)
      .digest('hex')
      .slice(0, 32);
    await this.feishu.sendText(
      user.feishuOpenId,
      formatInspectionAlert(input),
      uuid,
    );
    // Bounded process-local cache; eviction/restart and separate processes can resend.
    if (this.sent.size >= 1000 && !this.sent.has(key))
      this.sent.delete(this.sent.keys().next().value!);
    this.sent.set(key, level);
  }
}
