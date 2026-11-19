import { HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorCodeValue } from '../../common/constants/error-code';
import { BusinessException } from '../../common/exceptions/business.exception';

export function assertMatchingId(bodyId: string | undefined, pathId: string) {
  if (bodyId && bodyId !== pathId) {
    throw new BusinessException({
      code: ErrorCode.RESOURCE_ID_MISMATCH,
      message: '提交的记录与当前编辑的记录不一致，请刷新后再试。',
      status: HttpStatus.BAD_REQUEST,
    });
  }
}

export function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new BusinessException({
      code: ErrorCode.RESOURCE_VERSION_CONFLICT,
      message: '资源已被更新，请刷新后重试。',
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
      message: '部分资源已不存在，请刷新后重新选择。',
      status: HttpStatus.NOT_FOUND,
      details: {
        missingIds,
      },
    });
  }
}
