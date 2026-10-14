import { HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ErrorCode } from './constants/error-code';
import { BusinessException } from './exceptions/business.exception';

/**
 * Rejects writes to an inquiry (and its itineraries/quotes) that still has an
 * active tour. Call after the inquiry row is locked so creation and edits serialize.
 */
export async function assertNoActiveTour(
  manager: EntityManager,
  sourceModule: 'standard' | 'website',
  inquiryId: string,
): Promise<void> {
  const rows: unknown[] = await manager.query(
    `SELECT 1 FROM tours WHERE source_module = $1 AND inquiry_id = $2 AND status = 'active' LIMIT 1`,
    [sourceModule, inquiryId],
  );
  if (rows.length)
    throw new BusinessException({
      code: ErrorCode.INQUIRY_READ_ONLY,
      message: 'Inquiry has an active tour and is read-only',
      status: HttpStatus.CONFLICT,
    });
}
