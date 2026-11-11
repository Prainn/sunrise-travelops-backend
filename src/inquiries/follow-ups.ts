import { notificationEnabled } from '../notifications/notification-settings';
import { HttpStatus } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception';

export function reminderDueAt(
  next: string | null | undefined,
  days: number | null | undefined,
  now = Date.now(),
): Date | null {
  if (days == null) return null;
  const time = next ? Date.parse(next) : NaN;
  if (![1, 3, 5, 15].includes(days) || !Number.isFinite(time))
    throw new BusinessException({
      code: 'VALIDATION_ERROR',
      status: HttpStatus.BAD_REQUEST,
      message: '设置提醒必须填写下次跟进时间',
    });
  // Shanghai has no DST; subtract calendar days while preserving the wall-clock time.
  const due = new Date(time - days * 86400000);
  if (due.getTime() <= now)
    throw new BusinessException({
      code: 'VALIDATION_ERROR',
      status: HttpStatus.BAD_REQUEST,
      message: '提醒时间已过去，请调整下次跟进时间或提前量',
      details: { reason: 'FOLLOW_UP_REMINDER_IN_PAST' },
    });
  return due;
}

/** Caller holds the inquiry row; cancellation serializes with delivery and tour formation. */
export async function cancelInquiryReminders(
  manager: EntityManager,
  inquiryId: string,
) {
  await manager.query(
    `UPDATE inquiry_follow_up_reminders SET status='cancelled',updated_at=now() WHERE inquiry_id=$1 AND status IN ('pending','sending','failed')`,
    [inquiryId],
  );
}

export async function appendFollowUp(
  manager: EntityManager,
  inquiryId: string,
  input: {
    remark: string;
    nextFollowUpAt?: string | null;
    reminderDays?: number | null;
    requestId?: string;
  },
  actor: { id: string; name: string },
  schedule = true,
) {
  const due = reminderDueAt(input.nextFollowUpAt, input.reminderDays);
  await cancelInquiryReminders(manager, inquiryId);
  const [row] = await manager.query<{ id: string }[]>(
    `INSERT INTO inquiry_follow_ups(inquiry_id,request_id,remark,next_follow_up_at,reminder_days,followed_at,followed_by,followed_by_name)
    VALUES($1,$2,$3,$4,$5,now(),$6,$7) RETURNING id`,
    [
      inquiryId,
      input.requestId ?? null,
      input.remark,
      input.nextFollowUpAt ?? null,
      input.reminderDays ?? null,
      actor.id,
      actor.name,
    ],
  );
  if (due && schedule) {
    const enabled = await notificationEnabled(
      manager,
      'inquiry_follow_up',
      true,
    );
    await manager.query(
      `INSERT INTO inquiry_follow_up_reminders(follow_up_id,inquiry_id,due_at,status,error_code) VALUES($1,$2,$3,$4,$5)`,
      [
        row.id,
        inquiryId,
        due,
        enabled ? 'pending' : 'cancelled',
        enabled ? null : 'NOTIFICATION_DISABLED',
      ],
    );
  }
  return row.id;
}
