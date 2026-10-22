import { HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception';

export const COORDINATOR_DUTIES = ['reception', 'operation', 'both'] as const;
export type CoordinatorDuty = (typeof COORDINATOR_DUTIES)[number];

export function assignmentInvalid(message: string): never {
  throw new BusinessException({
    code: 'VALIDATION_ERROR',
    message,
    status: HttpStatus.BAD_REQUEST,
  });
}

export async function requireBusinessGroup(manager: EntityManager, id: string) {
  const [group] = await manager.query<{ id: string; name: string }[]>(
    "SELECT id,name FROM business_groups WHERE id=$1 AND status='enabled' FOR SHARE",
    [id],
  );
  return group ?? assignmentInvalid('请选择启用的霖熹业务组');
}
