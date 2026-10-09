import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../common/constants/error-code';
import { BusinessException } from '../common/exceptions/business.exception';
import type { PageResult } from '../common/types/page-result';
import { resourceLibrary } from '../resources/common/resource-scope';
import { LeaveInputDto, LeaveQueryDto, UpdateLeaveDto } from './tour.dto';

type Row = Record<string, unknown>;

const fail = (code: string, message: string, status: HttpStatus): never => {
  throw new BusinessException({
    code: code as never,
    message,
    status,
  });
};
const SELECT = `l.id, g.library, l.guide_person_id AS "guidePersonId", g.name AS "guideName", g.code AS "guideCode",
  l.start_date::text AS "startDate", l.end_date::text AS "endDate", l.reason, l.remark, l.version,
  l.created_at AS "createdAt", l.updated_at AS "updatedAt", l.created_by AS "createdBy", l.updated_by AS "updatedBy"`;
const FROM = `resource_guide_leaves l JOIN resource_guide_people g ON g.id = l.guide_person_id`;

@Injectable()
export class GuideLeavesService {
  constructor(private readonly db: DataSource) {}

  async list(query: LeaveQueryDto): Promise<PageResult<Row>> {
    const library = resourceLibrary();
    const params: unknown[] = [];
    let where = 'WHERE l.deleted_at IS NULL AND g.deleted_at IS NULL';
    if (library) where += ` AND g.library = $${params.push(library)}`;
    if (query.guidePersonId)
      where += ` AND l.guide_person_id = $${params.push(query.guidePersonId)}`;
    if (query.from) where += ` AND l.end_date >= $${params.push(query.from)}`;
    if (query.to) where += ` AND l.start_date <= $${params.push(query.to)}`;
    const keyword = query.keyword?.trim();
    if (keyword) {
      const p = `$${params.push(`%${keyword}%`)}`;
      where += ` AND (g.name ILIKE ${p} OR g.code ILIKE ${p} OR l.reason ILIKE ${p})`;
    }
    const total = await this.db.query<{ count: string }[]>(
      `SELECT count(*) FROM ${FROM} ${where}`,
      params,
    );
    const list = await this.db.query<Row[]>(
      `SELECT ${SELECT} FROM ${FROM} ${where} ORDER BY l.start_date DESC, l.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(total[0].count),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Serializes with tour assignment by locking the guide row first. */
  private async check(manager: DataSource['manager'], input: LeaveInputDto) {
    if (input.startDate > input.endDate)
      fail(
        ErrorCode.VALIDATION_ERROR,
        '开始日期不能晚于结束日期',
        HttpStatus.BAD_REQUEST,
      );
    const library = resourceLibrary(true);
    const guide = await manager.query<unknown[]>(
      `SELECT id FROM resource_guide_people WHERE id = $1 AND library = $2 AND deleted_at IS NULL FOR UPDATE`,
      [input.guidePersonId, library],
    );
    if (!guide.length)
      fail(ErrorCode.RESOURCE_NOT_FOUND, '导游不存在', HttpStatus.NOT_FOUND);
    const busy = await manager.query<unknown[]>(
      `SELECT 1 FROM tours WHERE guide_id = $1 AND status = 'active'
       AND occupy_from <= $3 AND occupy_to >= $2 LIMIT 1`,
      [input.guidePersonId, input.startDate, input.endDate],
    );
    if (busy.length)
      fail(
        ErrorCode.CONFLICT,
        '请假日期与导游已有旅行团冲突',
        HttpStatus.CONFLICT,
      );
  }

  async create(input: LeaveInputDto, actorId: string): Promise<Row> {
    const id = await this.db.transaction(async (manager) => {
      await this.check(manager, input);
      const rows = await manager.query<{ id: string }[]>(
        `INSERT INTO resource_guide_leaves (guide_person_id, start_date, end_date, reason, remark, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
        [
          input.guidePersonId,
          input.startDate,
          input.endDate,
          input.reason,
          input.remark,
          actorId,
        ],
      );
      return rows[0].id;
    });
    return this.get(id);
  }

  async update(
    id: string,
    input: UpdateLeaveDto,
    actorId: string,
  ): Promise<Row> {
    await this.db.transaction(async (manager) => {
      const rows = await manager.query<Row[]>(
        `SELECT l.* FROM resource_guide_leaves l WHERE l.id = $1 AND l.deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      if (!rows[0])
        fail(
          ErrorCode.RESOURCE_NOT_FOUND,
          '请假记录不存在',
          HttpStatus.NOT_FOUND,
        );
      if (rows[0].version !== input.version)
        fail(
          ErrorCode.RESOURCE_VERSION_CONFLICT,
          '记录已更新，请重新加载',
          HttpStatus.CONFLICT,
        );
      if (rows[0].guide_person_id !== input.guidePersonId)
        fail(
          ErrorCode.VALIDATION_ERROR,
          '不能更换请假导游',
          HttpStatus.BAD_REQUEST,
        );
      await this.check(manager, input);
      await manager.query(
        `UPDATE resource_guide_leaves SET start_date=$2, end_date=$3, reason=$4, remark=$5,
         version=version+1, updated_at=now(), updated_by=$6 WHERE id=$1`,
        [
          id,
          input.startDate,
          input.endDate,
          input.reason,
          input.remark,
          actorId,
        ],
      );
    });
    return this.get(id);
  }

  async delete(ids: string[], actorId: string): Promise<void> {
    const library = resourceLibrary(true);
    const uniqueIds = [...new Set(ids)];
    await this.db.transaction(async (m) => {
      const rows = await m.query<Row[]>(
        `SELECT l.id FROM ${FROM} WHERE l.id = ANY($1::uuid[]) AND l.deleted_at IS NULL
          AND g.deleted_at IS NULL AND g.library = $2 FOR UPDATE OF l`,
        [uniqueIds, library],
      );
      if (rows.length !== uniqueIds.length)
        fail(
          ErrorCode.RESOURCE_NOT_FOUND,
          '请假记录不存在',
          HttpStatus.NOT_FOUND,
        );
      await m.query(
        `UPDATE resource_guide_leaves SET deleted_at=now(), updated_at=now(),
        updated_by=$2, version=version+1 WHERE id=ANY($1::uuid[])`,
        [uniqueIds, actorId],
      );
    });
  }

  async get(id: string): Promise<Row> {
    const library = resourceLibrary();
    const rows = await this.db.query<Row[]>(
      `SELECT ${SELECT} FROM ${FROM} WHERE l.id = $1 AND l.deleted_at IS NULL AND g.deleted_at IS NULL AND ($2::text IS NULL OR g.library = $2)`,
      [id, library],
    );
    return (
      rows[0] ??
      fail(ErrorCode.RESOURCE_NOT_FOUND, '请假记录不存在', HttpStatus.NOT_FOUND)
    );
  }
}
