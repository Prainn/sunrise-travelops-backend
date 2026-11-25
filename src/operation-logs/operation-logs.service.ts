import {
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { OperationLogJournal, StoredOperation } from './operation-log-journal';
import { ILike, Raw, Repository } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception';
import type { LoginScope } from '../users/user-identity.entity';
import { OperationLogEntity } from './operation-log.entity';

export const OPERATION_CATEGORIES = [
  'login',
  'user',
  'system-category',
  'business-category',
  'resource',
  'inquiry',
  'itinerary',
  'quotation',
  'tour',
  'guide-leave',
  'guide-rating',
  'website-config',
  'ledger',
  'website-visit',
  'whatsapp',
  'client',
] as const;
export type OperationCategory = (typeof OPERATION_CATEGORIES)[number];

export const OPERATION_RESULTS = [
  'success',
  'failure',
  'denied',
  'cancelled',
  'unknown',
  'pending',
] as const;
export type OperationResult = (typeof OPERATION_RESULTS)[number];
export type OperationScope = LoginScope | 'unknown';

const renamedActions = new Map([
  ['quotation/冻结报价', '确认报价'],
  ['quotation/冻结独立站报价', '确认独立站报价'],
  ['system-category/重试OSS媒体保存', '重新归档媒体文件'],
  ['system-category/重试WhatsApp接收事件', '重新处理接收事件'],
  ['website-visit/访问记录生成询盘', '从访问记录新增询盘'],
  ['whatsapp/WhatsApp会话 / 开启新咨询', 'WhatsApp会话 / 开启新会话'],
  ['whatsapp/WhatsApp会话 / 从会话生成询盘', 'WhatsApp会话 / 从会话新增询盘'],
]);

/** 仅转换系统生成的动作名称，历史审计原文及人员输入的详情均保留。 */
function displayAction({ category, action, scope }: OperationLogEntity) {
  if (category === 'tour')
    return action.replace(/^(新增|编辑|撤销)旅行团$/, '$1成团记录');
  if (category === 'website-config')
    return action.replace(/^(新增|编辑|删除|保存)独立站配置$/, '$1独立站资源');
  if (category === 'resource') {
    return action
      .replace(/^(新增|编辑|删除|启用|停用)旅行社(联系人)?$/, '$1组团社$2')
      .replace(/^(新增|编辑|删除|启用|停用)导游服务价格$/, '$1导游价格')
      .replace(/^(新增|编辑|删除|启用|停用)导游人员$/, '$1导游')
      .replace(/^停用/, '禁用');
  }
  // 总部历史记录没有目标业务，不从操作人推断台账归属。
  if (category === 'ledger' && (scope === 'linxi' || scope === 'website')) {
    return action.replace(
      /^(新增|编辑|删除|审核|保存)霖熹\/独立站台账(操作信息)?$/,
      `$1${scope === 'linxi' ? '霖熹' : '独立站'}台账$2`,
    );
  }
  return renamedActions.get(`${category}/${action}`) ?? action;
}

export type OperationEntry = Pick<
  OperationLogEntity,
  | 'category'
  | 'action'
  | 'success'
  | 'actorId'
  | 'actorName'
  | 'scope'
  | 'detail'
  | 'ip'
> & { id?: string; time?: Date; result?: OperationResult };

@Injectable()
export class OperationLogsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OperationLogsService.name);
  private readonly journal = new OperationLogJournal(
    process.env.OPERATION_LOG_RETRY_DIR ??
      join(process.cwd(), '.operation-log-retry'),
  );
  private timer?: ReturnType<typeof setInterval>;
  private replaying?: Promise<void>;

  onModuleInit() {
    const retry = () => {
      this.replaying ??= this.journal
        .replay((rows) => this.insert(rows))
        .catch(() => this.logger.error('Operation log replay unavailable'))
        .finally(() => {
          this.replaying = undefined;
        });
    };
    retry();
    this.timer = setInterval(retry, 15000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.replaying;
  }

  private async insert(rows: StoredOperation[]) {
    await this.logs
      .createQueryBuilder()
      .insert()
      .into(OperationLogEntity)
      .values(rows)
      .orIgnore()
      .execute();
  }

  constructor(
    @InjectRepository(OperationLogEntity)
    private readonly logs: Repository<OperationLogEntity>,
  ) {}

  async append(entries: OperationEntry[]): Promise<void> {
    if (!entries.length) return;
    const rows = entries.map((entry) => ({
      ...entry,
      id: entry.id ?? randomUUID(),
      time: entry.time ?? new Date(),
    }));
    try {
      await this.insert(rows);
    } catch {
      try {
        await this.journal.save(rows);
        this.logger.warn('Operation log deferred for durable replay');
      } catch {
        this.logger.error(
          'Both operation log persistence and recovery storage are unavailable',
        );
        throw new ServiceUnavailableException(
          '操作结果无法可靠记录，请核对业务状态',
        );
      }
    }
  }

  async page(
    page: number,
    pageSize: number,
    category?: OperationCategory,
    scope?: OperationScope,
    filters: {
      start?: string;
      end?: string;
      actorName?: string;
      snapshotAt?: string;
    } = {},
  ) {
    const { start, end } = filters;
    const snapshotAt = filters.snapshotAt ?? new Date().toISOString();
    if (start && end && start > end) {
      throw new BusinessException({
        code: 'VALIDATION_ERROR',
        message: '开始日期不能晚于结束日期',
        status: HttpStatus.BAD_REQUEST,
      });
    }
    const actorName = filters.actorName?.trim();
    const [list, total] = await this.logs.findAndCount({
      where: {
        ...(category ? { category } : {}),
        ...(scope ? { scope } : {}),
        ...(actorName
          ? { actorName: ILike(`%${actorName.replace(/[\\%_]/g, '\\$&')}%`) }
          : {}),
        time: Raw(
          (column) =>
            [
              start ? `${column} >= :start::timestamptz` : '',
              end ? `${column} < :end::timestamptz + interval '24 hours'` : '',
              `${column} < :snapshotAt::timestamptz`,
            ]
              .filter(Boolean)
              .join(' AND '),
          {
            snapshotAt,
            ...(start ? { start: `${start}T00:00:00+08:00` } : {}),
            ...(end ? { end: `${end}T00:00:00+08:00` } : {}),
          },
        ),
      },
      order: { time: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      list: list.map((row) => ({
        ...row,
        action: displayAction(row),
        result: row.result ?? (row.success ? 'success' : 'failure'),
      })),
      total,
      snapshotAt,
      page,
      pageSize,
    };
  }
}
