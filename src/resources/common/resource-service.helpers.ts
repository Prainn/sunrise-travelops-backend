import { HttpStatus } from '@nestjs/common';
import { FindOptionsWhere, In, Not, ObjectLiteral, Repository } from 'typeorm';
import { ErrorCode, ErrorCodeValue } from '../../common/constants/error-code';
import { BusinessException } from '../../common/exceptions/business.exception';
import { assertAllFound } from './resource-errors';

export async function ensureCodeAvailable<
  T extends ObjectLiteral & { id: string; code: string },
>(repository: Repository<T>, code: string, excludedId?: string): Promise<void> {
  const where = (
    excludedId ? { code, id: Not(excludedId) } : { code }
  ) as FindOptionsWhere<T>;
  if (await repository.findOne({ where, withDeleted: true })) {
    throw new BusinessException({
      code: ErrorCode.RESOURCE_CODE_EXISTS,
      message: 'Resource code already exists',
      status: HttpStatus.CONFLICT,
      details: { code },
    });
  }
}

export async function requireResource<T extends ObjectLiteral & { id: string }>(
  repository: Repository<T>,
  id: string,
  errorCode: ErrorCodeValue,
): Promise<T> {
  const entity = await repository.findOneBy({ id } as FindOptionsWhere<T>);
  if (!entity) {
    throw new BusinessException({
      code: errorCode,
      message: 'Resource was not found',
      status: HttpStatus.NOT_FOUND,
    });
  }
  return entity;
}

export async function requireResourceForUpdate<
  T extends ObjectLiteral & { id: string },
>(
  repository: Repository<T>,
  id: string,
  errorCode: ErrorCodeValue,
): Promise<T> {
  const entity = await repository.findOne({
    where: { id } as FindOptionsWhere<T>,
    lock: { mode: 'pessimistic_write' },
  });
  if (!entity) {
    throw new BusinessException({
      code: errorCode,
      message: 'Resource was not found',
      status: HttpStatus.NOT_FOUND,
    });
  }
  return entity;
}

export async function requireResources<
  T extends ObjectLiteral & { id: string },
>(
  repository: Repository<T>,
  ids: string[],
  errorCode: ErrorCodeValue,
): Promise<T[]> {
  const uniqueIds = [...new Set(ids)];
  const entities = await repository.findBy({
    id: In(uniqueIds),
  } as FindOptionsWhere<T>);
  assertAllFound(
    uniqueIds,
    entities.map((entity) => entity.id),
    errorCode,
  );
  return entities;
}

export function normalizeNullable<T>(value: T | null | undefined): T | null {
  return value ?? null;
}
