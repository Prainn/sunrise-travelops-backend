import { HttpStatus } from '@nestjs/common';
import { FindOptionsWhere, In, Not, ObjectLiteral, Repository } from 'typeorm';
import { ApplicationError } from '../../common/errors/application-error';
import { assertAllFound } from './resource-errors';

export async function ensureCodeAvailable<
  T extends ObjectLiteral & { id: string; code: string },
>(repository: Repository<T>, code: string, excludedId?: string): Promise<void> {
  const where = (
    excludedId ? { code, id: Not(excludedId) } : { code }
  ) as FindOptionsWhere<T>;
  if (await repository.findOne({ where, withDeleted: true })) {
    throw new ApplicationError(
      'RESOURCE_CODE_EXISTS',
      'Resource code already exists',
      HttpStatus.CONFLICT,
      { code },
    );
  }
}

export async function requireResource<T extends ObjectLiteral & { id: string }>(
  repository: Repository<T>,
  id: string,
  errorCode: string,
): Promise<T> {
  const entity = await repository.findOneBy({ id } as FindOptionsWhere<T>);
  if (!entity) {
    throw new ApplicationError(
      errorCode,
      'Resource was not found',
      HttpStatus.NOT_FOUND,
    );
  }
  return entity;
}

export async function requireResourceForUpdate<
  T extends ObjectLiteral & { id: string },
>(repository: Repository<T>, id: string, errorCode: string): Promise<T> {
  const entity = await repository.findOne({
    where: { id } as FindOptionsWhere<T>,
    lock: { mode: 'pessimistic_write' },
  });
  if (!entity) {
    throw new ApplicationError(
      errorCode,
      'Resource was not found',
      HttpStatus.NOT_FOUND,
    );
  }
  return entity;
}

export async function requireResources<
  T extends ObjectLiteral & { id: string },
>(repository: Repository<T>, ids: string[], errorCode: string): Promise<T[]> {
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
