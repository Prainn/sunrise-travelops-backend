import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ATTRACTION_CATEGORIES,
  AttractionCategory,
} from '../../common/resource.constants';
import {
  ResourceAuditResponse,
  ResourceInputDto,
  ResourceQueryDto,
  moneyTransform,
  optionalTrimmedString,
} from '../../common/resource.dto';

export class AttractionQueryDto extends ResourceQueryDto {
  @IsOptional() @optionalTrimmedString @IsString() area?: string;
  @IsOptional() @IsIn(ATTRACTION_CATEGORIES) category?: AttractionCategory;
  @IsOptional() @optionalTrimmedString @IsString() unit?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isStandardPrice?: boolean;
}
export class CreateAttractionDto extends ResourceInputDto {
  @optionalTrimmedString @IsString() @MinLength(1) @MaxLength(100) area: string;
  @optionalTrimmedString @IsString() @MinLength(1) description: string;
  @moneyTransform @Matches(/^\d{1,10}(?:\.\d{1,2})?$/) price: string;
  @optionalTrimmedString @IsString() @MaxLength(100) unit: string;
  @IsOptional()
  @IsIn(ATTRACTION_CATEGORIES)
  category?: AttractionCategory | null;
  @IsOptional()
  @optionalTrimmedString
  @IsString()
  @MaxLength(500)
  restroomLocation?: string;
  @IsOptional() @IsBoolean() isStandardPrice?: boolean;
  @IsOptional() @optionalTrimmedString @IsString() remark?: string;
}
export class UpdateAttractionDto extends CreateAttractionDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
export class AttractionResponse implements ResourceAuditResponse {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  code: string;
  name: string;
  area: string;
  category: AttractionCategory | null;
  restroomLocation: string;
  description: string;
  isStandardPrice: boolean;
  remark: string;
  unit: string;
  /** Null for migrated records that still need a price. */
  price: string | null;
  status: string;
}
