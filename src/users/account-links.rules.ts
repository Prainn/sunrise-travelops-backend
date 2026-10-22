import { ErrorCodeValue } from '../common/constants/error-code';
import { HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { BusinessException } from '../common/exceptions/business.exception';

export function linkError(
  message: string,
  code: ErrorCodeValue = 'VALIDATION_ERROR',
  status = HttpStatus.BAD_REQUEST,
): never {
  throw new BusinessException({ code, message, status });
}

export function assertLinkAdmin(actor: AuthenticatedUser) {
  if (
    actor.scope !== 'headquarters' ||
    (!actor.roles.includes('ROOT') &&
      (!actor.roles.includes('ADMIN') || actor.roles.includes('EXECUTIVE')))
  )
    linkError(
      '仅总部超级管理员和系统管理员可管理账号关联',
      'AUTH_FORBIDDEN',
      HttpStatus.FORBIDDEN,
    );
}

// Shared with user management and account switching. Always acquire before user/session rows.
export async function lockAccountLinks(manager: EntityManager) {
  await manager.query(
    "SELECT pg_advisory_xact_lock(hashtext('account-links'))",
  );
}

export async function availableTourCode(
  manager: EntityManager,
  value: string,
  userId: string | null = null,
) {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(code)) linkError('团号标识须为1–10位字母数字');
  await manager.query(
    "SELECT pg_advisory_xact_lock(hashtext('user-tour-code'), hashtext($1))",
    [code],
  );
  const [row] = await manager.query<{ exists: boolean }[]>(
    `SELECT EXISTS(
    SELECT 1 FROM users u WHERE u.deleted_at IS NULL AND upper(btrim(u.tour_code))=$1
    AND ($2::uuid IS NULL OR u.id<>$2)
    AND (u.account_link_id IS NULL OR u.account_link_id IS DISTINCT FROM (SELECT account_link_id FROM users WHERE id=$2))
  ) AS exists`,
    [code, userId],
  );
  if (row.exists)
    linkError(
      '团号标识已被组外账号使用，请修改后保存',
      'USER_TOUR_CODE_EXISTS',
      HttpStatus.CONFLICT,
    );
  return code;
}
