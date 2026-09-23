import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationLogEntity } from './operation-log.entity';

export const OPERATION_CATEGORIES = [
  'login',
  'user',
  'system-category',
  'business-category',
  'resource',
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

  async page(page: number, pageSize: number, category?: OperationCategory) {
    const [list, total] = await this.logs.findAndCount({
      where: category ? { category } : {},
      order: { time: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }
}
