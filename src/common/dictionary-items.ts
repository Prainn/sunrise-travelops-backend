import { HttpStatus } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ErrorCode } from './constants/error-code';
import { BusinessException } from './exceptions/business.exception';

export interface DictionaryRef {
  id: string;
  code: string;
  name: string;
  englishName: string;
}

/** Loads an enabled item of the given dictionary type or rejects. */
export async function requireDictionaryItem(
  manager: EntityManager,
  typeCode: 'country-region' | 'city-airport',
  id: string,
): Promise<DictionaryRef> {
  const rows: DictionaryRef[] = await manager.query(
    `SELECT i.id, i.code, i.name, i.english_name AS "englishName"
     FROM system_business_dictionary_items i
     JOIN system_business_dictionary_types t ON t.id = i.type_id AND t.deleted_at IS NULL
     WHERE i.id = $1 AND t.code = $2 AND i.status = 'enabled' AND i.deleted_at IS NULL`,
    [id, typeCode],
  );
  if (!rows[0])
    throw new BusinessException({
      code: ErrorCode.VALIDATION_ERROR,
      message: `Invalid ${typeCode} item`,
      status: HttpStatus.BAD_REQUEST,
    });
  return rows[0];
}
