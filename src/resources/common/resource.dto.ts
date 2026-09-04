import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ResourceStatus } from './resource.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const moneyString = ({ value }: { value: unknown }): unknown =>
  value === null || value === undefined || value === ''
    ? value
    : typeof value === 'string' || typeof value === 'number'
      ? String(value).trim()
      : value;

export class ResourceQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ResourceStatus)
  status?: ResourceStatus;
}

export class BatchIdsQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? [...new Set(value.split(',').map((id) => id.trim()))].filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  ids: string[];
}

export abstract class ResourceInputDto {
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_-]{1,49}$/)
  code: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name: string;

  @IsEnum(ResourceStatus)
  status: ResourceStatus;
}

export function normalizeMoney(value: string | number): string {
  const [integer, fraction = ''] = String(value).split('.');
  return `${integer}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

export function actualPage(query: ResourceQueryDto): number {
  return query.page;
}

export function actualKeyword(query: ResourceQueryDto): string | undefined {
  return query.keyword?.trim() || undefined;
}

export interface ResourceAuditResponse {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export function auditResponse(entity: {
  id: string;
  version: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}): ResourceAuditResponse {
  return {
    id: entity.id,
    version: entity.version,
    createdAt: entity.createdAt.toISOString(),
    createdBy: entity.createdBy,
    updatedAt: entity.updatedAt.toISOString(),
    updatedBy: entity.updatedBy,
  };
}

export const optionalTrimmedString = Transform(trim);
export const moneyTransform = Transform(moneyString);
