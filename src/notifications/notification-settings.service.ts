import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';
import {
  NOTIFICATION_TYPES,
  NotificationType,
  NotificationWindow,
} from './notification-settings';

const settingColumns = `type,enabled,version,updated_at AS "updatedAt",
  CASE WHEN window_start IS NOT NULL THEN json_build_object('start',to_char(window_start,'HH24:MI'),'end',to_char(window_end,'HH24:MI')) END AS "sendWindow"`;

interface Setting {
  sendWindow: NotificationWindow | null;
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
      `SELECT ${settingColumns} FROM feishu_notification_settings ORDER BY type`,
    );
    return rows.map((row) => ({ ...row, name: NOTIFICATION_TYPES[row.type] }));
  }
  async update(
    type: string,
    input: {
      enabled: boolean;
      version: number;
      sendWindow?: NotificationWindow | null;
    },
    actor: AuthenticatedUser,
  ) {
    this.authorize(actor, 'sys:notification:update');
    if (!Object.hasOwn(NOTIFICATION_TYPES, type))
      throw new BusinessException({
        code: 'NOT_FOUND',
        message: '通知类型不存在',
        status: 404,
      });
    const window = input.sendWindow;
    if (window && window.start === window.end)
      throw new BusinessException({
        code: 'VALIDATION_ERROR',
        message: '通知时段的起止时间不能相同',
        status: 400,
      });
    return this.db.transaction(async (manager) => {
      const [[row]] = await manager.query<[Setting[], number]>(
        `UPDATE feishu_notification_settings SET enabled=$2,window_start=CASE WHEN $5 THEN $6::time ELSE window_start END,window_end=CASE WHEN $5 THEN $7::time ELSE window_end END,version=version+1,updated_at=now(),updated_by=$4,last_disabled_at=CASE WHEN $2 THEN last_disabled_at ELSE clock_timestamp() END WHERE type=$1 AND version=$3 RETURNING ${settingColumns}`,
        [
          type,
          input.enabled,
          input.version,
          actor.id,
          window !== undefined,
          window?.start ?? null,
          window?.end ?? null,
        ],
      );
      if (!row)
        throw new BusinessException({
          code: 'CONFLICT',
          message: '通知设置已更新，请刷新后重试',
          status: 409,
        });
      if (window !== undefined && row.enabled)
        await this.reschedule(manager, row.type, window);
      return { ...row, name: NOTIFICATION_TYPES[row.type] };
    });
  }
  private async reschedule(
    manager: EntityManager,
    type: NotificationType,
    window: NotificationWindow | null,
  ) {
    const args = [type, window?.start ?? null, window?.end ?? null];
    // Keep an existing digest a digest when the window is shortened, extended or cleared.
    // An advance reminder can never become eligible before its original due time.
    const deadline = (
      due: string,
    ) => `coalesce(feishu_window_resume($2::time,$3::time,greatest(statement_timestamp(),${due})),
      CASE WHEN j.digest_at IS NOT NULL THEN greatest(date_trunc('minute',statement_timestamp()),${due}) END)`;
    if (type.startsWith('whatsapp_'))
      await manager.query(
        `UPDATE whatsapp_notification_deliveries j SET digest_at=${deadline('least(j.next_attempt_at,statement_timestamp())')}
        FROM whatsapp_notification_batches b WHERE b.id=j.batch_id AND b.type=$1 AND j.status='pending' AND j.digest_id IS NULL`,
        args,
      );
    else if (type === 'mail_unassigned')
      await manager.query(
        `UPDATE mail_notification_deliveries j SET digest_at=${deadline('least(j.next_attempt_at,statement_timestamp())')}
        WHERE $1::text='mail_unassigned' AND j.status='pending' AND j.digest_id IS NULL`,
        args,
      );
    else if (type === 'inquiry_follow_up')
      await manager.query(
        `UPDATE inquiry_follow_up_reminders j SET digest_at=${deadline('j.due_at')}
        WHERE $1::text='inquiry_follow_up' AND j.status='pending' AND j.digest_id IS NULL`,
        args,
      );
    else
      await manager.query(
        `UPDATE feishu_ledger_notifications j SET digest_at=${deadline('j.created_at')}
        FROM direct_ledgers l WHERE l.id=j.ledger_id AND l.business_unit||'_ledger_'||j.kind=$1 AND j.status='pending' AND j.digest_id IS NULL`,
        args,
      );
  }
}
