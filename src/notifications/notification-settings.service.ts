import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';
import { NOTIFICATION_TYPES, NotificationType } from './notification-settings';

interface Setting {
  type: NotificationType;
  enabled: boolean;
  version: number;
  updatedAt: Date;
}
@Injectable()
export class NotificationSettingsService {
  constructor(private readonly db: DataSource) {}
  private authorize(actor: AuthenticatedUser, permission: string) {
    if (
      actor.scope !== 'headquarters' ||
      !actor.roles.some((r) => ['ROOT', 'BOSS', 'ADMIN'].includes(r)) ||
      !actor.permissions.includes(permission)
    )
      throw new BusinessException({
        code: 'AUTH_FORBIDDEN',
        message: '仅系统管理员可管理通知',
        status: 403,
      });
  }
  async list(actor: AuthenticatedUser) {
    this.authorize(actor, 'sys:notification:list');
    const rows = await this.db.query<Setting[]>(
      'SELECT type,enabled,version,updated_at AS "updatedAt" FROM feishu_notification_settings ORDER BY type',
    );
    return rows.map((row) => ({ ...row, name: NOTIFICATION_TYPES[row.type] }));
  }
  async update(
    type: string,
    input: { enabled: boolean; version: number },
    actor: AuthenticatedUser,
  ) {
    this.authorize(actor, 'sys:notification:update');
    if (!Object.hasOwn(NOTIFICATION_TYPES, type))
      throw new BusinessException({
        code: 'NOT_FOUND',
        message: '通知类型不存在',
        status: 404,
      });
    return this.db.transaction(async (manager) => {
      const [[row]] = await manager.query<[Setting[], number]>(
        `UPDATE feishu_notification_settings SET enabled=$2,version=version+1,updated_at=now(),updated_by=$4,last_disabled_at=CASE WHEN $2 THEN last_disabled_at ELSE clock_timestamp() END WHERE type=$1 AND version=$3 RETURNING type,enabled,version,updated_at AS "updatedAt"`,
        [type, input.enabled, input.version, actor.id],
      );
      if (!row)
        throw new BusinessException({
          code: 'CONFLICT',
          message: '通知设置已更新，请刷新后重试',
          status: 409,
        });
      return { ...row, name: NOTIFICATION_TYPES[row.type] };
    });
  }
}
