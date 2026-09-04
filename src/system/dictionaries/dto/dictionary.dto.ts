import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  DICTIONARY_TAG_TYPES,
  DictionaryStatus,
  DictionaryTagType,
} from '../dictionary-status';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimAndLowercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class DictionaryTypeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DictionaryStatus })
  @IsOptional()
  @Type(() => Number)
  @IsIn([DictionaryStatus.Disabled, DictionaryStatus.Enabled])
  status?: DictionaryStatus;
}

export class DictionaryItemQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DictionaryStatus })
  @IsOptional()
  @Type(() => Number)
  @IsIn([DictionaryStatus.Disabled, DictionaryStatus.Enabled])
  status?: DictionaryStatus;
}

export class DictionaryTypeInputDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Accepted on update for compatibility with frontend form data',
  })
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @ApiProperty({ example: '用户性别' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'gender' })
  @Transform(trimAndLowercase)
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(100)
  dictCode: string;

  @ApiPropertyOptional({ enum: DictionaryStatus, default: 1 })
  @Type(() => Number)
  @IsIn([DictionaryStatus.Disabled, DictionaryStatus.Enabled])
  status: DictionaryStatus = DictionaryStatus.Enabled;

  @ApiPropertyOptional({ example: '用户资料中的性别选项' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  remark?: string;
}

export class DictionaryItemInputDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Accepted on update for compatibility with frontend form data',
  })
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @ApiPropertyOptional({
    description: 'Accepted for compatibility; the path remains authoritative',
    example: 'gender',
  })
  @IsOptional()
  @Transform(trimAndLowercase)
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(100)
  dictCode?: string;

  @ApiProperty({ example: '男' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  @ApiProperty({ example: '1' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  value: string;

  @ApiPropertyOptional({ enum: DictionaryStatus, default: 1 })
  @Type(() => Number)
  @IsIn([DictionaryStatus.Disabled, DictionaryStatus.Enabled])
  status: DictionaryStatus = DictionaryStatus.Enabled;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(-2147483648)
  @Max(2147483647)
  sort = 1;

  @ApiPropertyOptional({ enum: DICTIONARY_TAG_TYPES, default: '' })
  @IsIn(DICTIONARY_TAG_TYPES)
  tagType: DictionaryTagType = '';
}

export class BatchIdsQueryDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Comma-separated UUIDs are also accepted',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  ids: string[];
}

export class DictionaryCodeParamDto {
  @ApiProperty({ example: 'gender' })
  @Transform(trimAndLowercase)
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(100)
  dictCode: string;
}

export class DictionaryItemParamDto extends DictionaryCodeParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  id: string;
}

export class DictionaryTypeResponse {
  id: string;
  name: string;
  dictCode: string;
  status: DictionaryStatus;
  remark?: string;
}

export class DictionaryItemResponse {
  id: string;
  dictCode: string;
  label: string;
  value: string;
  status: DictionaryStatus;
  sort: number;
  tagType: DictionaryTagType;
}

export class DictionaryTypeOptionResponse {
  value: string;
  label: string;
}

export class DictionaryItemOptionResponse {
  value: string;
  label: string;
  tagType: DictionaryTagType;
}
