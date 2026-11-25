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
      list: list.map((row) => {
        const entry = {
          ...row,
          result: row.result ?? (row.success ? 'success' : 'failure'),
        };
        if (
          entry.category === 'resource' &&
          /^(新增|编辑|删除|启用|停用)旅行社(联系人)?$/.test(entry.action)
        ) {
          return {
            ...entry,
            action: entry.action.replace('旅行社', '组团社'),
          };
        }
        // 历史业务身份只能写本业务台账；总部历史事件缺少目标业务时保留原文。
        if (
          entry.category === 'ledger' &&
          (entry.scope === 'linxi' || entry.scope === 'website') &&
          /^(新增|编辑|删除|审核|保存)霖熹\/独立站台账(操作信息)?$/.test(
            entry.action,
          )
        ) {
          return {
            ...entry,
            action: entry.action.replace(
              '霖熹/独立站台账',
              entry.scope === 'linxi' ? '霖熹台账' : '独立站台账',
            ),
          };
        }
        return entry;
      }),
      total,
      snapshotAt,
      page,
      pageSize,
    };
  }
}
