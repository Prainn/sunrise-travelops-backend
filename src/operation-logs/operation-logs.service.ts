import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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
] as const;
export type OperationCategory = (typeof OPERATION_CATEGORIES)[number];

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
>;

@Injectable()
export class OperationLogsService {
  constructor(
    @InjectRepository(OperationLogEntity)
    private readonly logs: Repository<OperationLogEntity>,
  ) {}

  async append(entries: OperationEntry[]): Promise<void> {
    if (entries.length) await this.logs.insert(entries);
  }

  async page(
    page: number,
    pageSize: number,
    category?: OperationCategory,
    scope?: LoginScope,
    filters: { start?: string; end?: string; actorName?: string } = {},
  ) {
    const { start, end } = filters;
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
        ...(start || end
          ? {
              time: Raw(
                (column) =>
                  [
                    start ? `${column} >= :start::timestamptz` : '',
                    end
                      ? `${column} < :end::timestamptz + interval '24 hours'`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' AND '),
                {
                  ...(start ? { start: `${start}T00:00:00+08:00` } : {}),
                  ...(end ? { end: `${end}T00:00:00+08:00` } : {}),
                },
              ),
            }
          : {}),
      },
      order: { time: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      list: list.map((entry) => {
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
      page,
      pageSize,
    };
  }
}
