import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';
import {
  BusinessGroupQueryDto,
  CreateBusinessGroupDto,
  UpdateBusinessGroupDto,
} from './dto/business-group.dto';

const SELECT =
  'g.id,g.name,g.status,g.version,g.created_at AS "createdAt",g.updated_at AS "updatedAt"';
interface GroupRow {
  id: string;
  name: string;
  status: 'enabled' | 'disabled';
  version: number;
}

export function assertBusinessGroupAccess(
  actor: AuthenticatedUser,
  action: 'list' | 'create' | 'update',
) {
  if (
    !['headquarters', 'linxi'].includes(actor.scope) ||
    !actor.permissions.includes(`sys:business-group:${action}`) ||
    (actor.scope === 'linxi' && !actor.roles.includes('BUSINESS_MANAGER'))
  ) {
    throw new BusinessException({
      code: 'AUTH_FORBIDDEN',
      message: '没有权限管理霖熹业务组',
      status: HttpStatus.FORBIDDEN,
    });
  }
}

@Injectable()
export class BusinessGroupsService {
  constructor(private readonly db: DataSource) {}
  async list(query: BusinessGroupQueryDto, actor: AuthenticatedUser) {
    assertBusinessGroupAccess(actor, 'list');
    const params: unknown[] = [];
    let where = 'WHERE true';
    if (query.status) where += ` AND g.status=$${params.push(query.status)}`;
    if (query.keyword?.trim())
      where += ` AND g.name ILIKE $${params.push(`%${query.keyword.trim()}%`)}`;
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(*) AS total FROM business_groups g ${where}`,
      params,
    );
    const list = await this.db.query<GroupRow[]>(
      `SELECT ${SELECT},(SELECT count(*)::int FROM user_identities i JOIN users u ON u.id=i.user_id WHERE i.business_group_id=g.id AND i.scope='linxi' AND u.deleted_at IS NULL AND NOT u.is_superuser) AS "memberCount"
       FROM business_groups g ${where} ORDER BY g.created_at,g.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async get(id: string, actor: AuthenticatedUser) {
    assertBusinessGroupAccess(actor, 'list');
    const [row] = await this.db.query<GroupRow[]>(
      `SELECT ${SELECT} FROM business_groups g WHERE g.id=$1`,
      [id],
    );
    if (!row)
      throw new BusinessException({
        code: 'NOT_FOUND',
        message: '业务组不存在',
        status: HttpStatus.NOT_FOUND,
      });
    return row;
  }
  private duplicate(error: unknown): never {
    if (
      error instanceof QueryFailedError &&
      (error.driverError as { constraint?: string }).constraint ===
        'uq_business_groups_name'
    )
      throw new BusinessException({
        code: 'CONFLICT',
        message: '业务组名称已存在',
        status: HttpStatus.CONFLICT,
      });
    throw error;
  }
  async create(input: CreateBusinessGroupDto, actor: AuthenticatedUser) {
    assertBusinessGroupAccess(actor, 'create');
    try {
      const [row] = await this.db.query<GroupRow[]>(
        `INSERT INTO business_groups AS g(name,created_by,updated_by) VALUES($1,$2,$2) RETURNING ${SELECT}`,
        [input.name, actor.id],
      );
      return row;
    } catch (error) {
      this.duplicate(error);
    }
  }
  async update(
    id: string,
    input: UpdateBusinessGroupDto,
    actor: AuthenticatedUser,
  ) {
    assertBusinessGroupAccess(actor, 'update');
    try {
      return await this.db.transaction(async (manager) => {
        const [row] = await manager.query<GroupRow[]>(
          `SELECT ${SELECT} FROM business_groups g WHERE g.id=$1 FOR UPDATE`,
          [id],
        );
        if (!row)
          throw new BusinessException({
            code: 'NOT_FOUND',
            message: '业务组不存在',
            status: HttpStatus.NOT_FOUND,
          });
        if (row.version !== input.version)
          throw new BusinessException({
            code: 'CONFLICT',
            message: '业务组已更新，请刷新后重试',
            status: HttpStatus.CONFLICT,
            details: { currentVersion: row.version },
          });
        const [[saved]] = await manager.query<[GroupRow[], number]>(
          `UPDATE business_groups AS g SET name=$2,status=$3,version=version+1,updated_at=now(),updated_by=$4 WHERE id=$1 RETURNING ${SELECT}`,
          [id, input.name, input.status, actor.id],
        );
        return saved;
      });
    } catch (error) {
      this.duplicate(error);
    }
  }
}
