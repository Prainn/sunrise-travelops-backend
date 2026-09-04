import { HttpStatus } from '@nestjs/common';
import { ApplicationError } from '../../common/errors/application-error';

export function assertMatchingId(bodyId: string | undefined, pathId: string) {
  if (bodyId && bodyId !== pathId) {
    throw new ApplicationError(
      'RESOURCE_ID_MISMATCH',
      'Body id does not match path id',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new ApplicationError(
      'VERSION_CONFLICT',
      'The resource was modified by another request',
      HttpStatus.CONFLICT,
      { expectedVersion: expected, actualVersion: actual },
    );
  }
}

export function assertAllFound(
  requestedIds: string[],
  foundIds: string[],
  code: string,
): void {
  const found = new Set(foundIds);
  const missingIds = requestedIds.filter((id) => !found.has(id));
  if (missingIds.length) {
    throw new ApplicationError(
      code,
      'One or more resources were not found',
      404,
      {
        missingIds,
      },
    );
  }
}
