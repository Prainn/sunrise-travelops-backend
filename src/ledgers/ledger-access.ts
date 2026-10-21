import { HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { ErrorCode, ErrorCodeValue } from '../common/constants/error-code';
import { BusinessException } from '../common/exceptions/business.exception';

export function invalid(message: string): never {
  throw new BusinessException({
    code: 'VALIDATION_ERROR',
    message,
    status: HttpStatus.BAD_REQUEST,
  });
}
export function forbidden(): never {
  throw new BusinessException({
    code: 'AUTH_FORBIDDEN',
    message: '没有权限执行此操作',
    status: HttpStatus.FORBIDDEN,
  });
}
export function missing(): never {
  throw new BusinessException({
    code: 'NOT_FOUND',
    message: '台账不存在',
    status: HttpStatus.NOT_FOUND,
  });
}
export function conflict(
  code: ErrorCodeValue,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new BusinessException({
    code,
    message,
    status: HttpStatus.CONFLICT,
    details,
  });
}
export function requirePermission(
  actor: AuthenticatedUser,
  permission: string,
) {
  if (!actor.permissions.includes(permission)) forbidden();
}
export function assertVersion(actual: number, expected: number) {
  if (actual !== expected)
    conflict(ErrorCode.LEDGER_VERSION_CONFLICT, '记录已更新，请刷新后重试');
}
export function isLedgerRoot(actor: AuthenticatedUser) {
  return actor.scope === 'headquarters' && actor.roles.includes('ROOT');
}
export function isManager(actor: AuthenticatedUser) {
  return (
    actor.scope !== 'headquarters' && actor.roles.includes('BUSINESS_MANAGER')
  );
}
export function directUnit(
  actor: AuthenticatedUser,
  unit?: 'linxi' | 'website',
) {
  if (actor.scope === 'headquarters')
    return unit ?? invalid('总部须选择霖熹或独立站');
  if (
    !['linxi', 'website'].includes(actor.scope) ||
    (unit && unit !== actor.scope)
  )
    forbidden();
  return actor.scope as 'linxi' | 'website';
}
export const COORDINATOR_FROM = `FROM users u JOIN user_identities i ON i.user_id=u.id
  WHERE i.scope=$1 AND u.status='enabled' AND u.deleted_at IS NULL AND NOT u.is_superuser
  AND EXISTS (SELECT 1 FROM identity_roles ir JOIN roles r ON r.id=ir.role_id
    WHERE ir.identity_id=i.id AND r.code='COORDINATOR' AND r.is_enabled)`;
export async function coordinator(
  manager: EntityManager,
  id: string,
  unit: string,
) {
  const [row] = await manager.query<{ id: string; name: string }[]>(
    `SELECT u.id,u.nickname AS name ${COORDINATOR_FROM} AND u.id=$2 FOR SHARE OF u,i`,
    [unit, id],
  );
  return row ?? invalid('请选择本业务的启用计调');
}
