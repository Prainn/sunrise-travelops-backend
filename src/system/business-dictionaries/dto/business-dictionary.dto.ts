import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BatchIdsQueryDto } from '../../dictionaries/dto/dictionary.dto';
import {
  BUSINESS_RESOURCE_TYPES,
  BusinessDictionaryStatus,
  BusinessResourceType,
} from '../business-dictionary-status';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class BusinessDictionaryTypeInputDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @ApiProperty({ example: '资源计价单位' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'Resource Price Units' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  englishName: string;

  @ApiProperty({ example: 'resource-unit' })
  @Transform(trim)
  @Matches(/^[a-z][a-zA-Z0-9-]*$/)
  @MaxLength(100)
  code: string;
}

export class BusinessDictionaryCodeParamDto {
  @ApiProperty({ example: 'resource-unit' })
  @Transform(trim)
  @Matches(/^[a-z][a-zA-Z0-9-]*$/)
  @MaxLength(100)
  typeCode: string;
}

export class BusinessDictionaryItemParamDto extends BusinessDictionaryCodeParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  id: string;
}

export class BusinessDictionaryItemQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ enum: BusinessDictionaryStatus })
  @IsOptional()
  @IsEnum(BusinessDictionaryStatus)
  status?: BusinessDictionaryStatus;
}

export class BusinessDictionaryItemInputDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @ApiProperty({ example: 'roomNight' })
  @Transform(trim)
  @Matches(/^[a-z][a-zA-Z0-9-]*$/)
  @MaxLength(100)
  code: string;

  @ApiProperty({ example: '间夜' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'Room night' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  englishName: string;

  @ApiPropertyOptional({ enum: BUSINESS_RESOURCE_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(BUSINESS_RESOURCE_TYPES, { each: true })
  resourceTypes: BusinessResourceType[] = [];

  @ApiPropertyOptional({ enum: BusinessDictionaryStatus })
  @IsEnum(BusinessDictionaryStatus)
  status: BusinessDictionaryStatus = BusinessDictionaryStatus.Enabled;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  remark = '';
}

export class BusinessDictionaryBatchIdsQueryDto extends BatchIdsQueryDto {}

export interface BusinessDictionaryItemResponse {
  id: string;
  code: string;
  name: string;
  englishName: string;
  resourceTypes: BusinessResourceType[];
  status: BusinessDictionaryStatus;
  remark: string;
}

export interface BusinessDictionaryTypeResponse {
  id: string;
  code: string;
  name: string;
  englishName: string;
  builtIn: boolean;
  items: BusinessDictionaryItemResponse[];
}
