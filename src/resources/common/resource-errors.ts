import { HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorCodeValue } from '../../common/constants/error-code';
import { BusinessException } from '../../common/exceptions/business.exception';

export function assertMatchingId(bodyId: string | undefined, pathId: string) {
  if (bodyId && bodyId !== pathId) {
    throw new BusinessException({
      code: ErrorCode.RESOURCE_ID_MISMATCH,
      message: 'Body id does not match path id',
      status: HttpStatus.BAD_REQUEST,
    });
  }
}

export function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new BusinessException({
      code: ErrorCode.RESOURCE_VERSION_CONFLICT,
      message: 'The resource was modified by another request',
      status: HttpStatus.CONFLICT,
      details: { expectedVersion: expected, actualVersion: actual },
    });
  }
}

export function assertAllFound(
  requestedIds: string[],
  foundIds: string[],
  code: ErrorCodeValue,
): void {
  const found = new Set(foundIds);
  const missingIds = requestedIds.filter((id) => !found.has(id));
  if (missingIds.length) {
    throw new BusinessException({
      code,
      message: 'One or more resources were not found',
      status: HttpStatus.NOT_FOUND,
      details: {
        missingIds,
      },
    });
  }
}
