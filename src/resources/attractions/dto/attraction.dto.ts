import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ATTRACTION_CATEGORIES,
  ATTRACTION_PRICE_ITEM_TYPES,
  AttractionCategory,
  AttractionPriceItemType,
} from '../../common/resource.constants';
import {
  ResourceAuditResponse,
  ResourceInputDto,
  ResourceQueryDto,
  moneyTransform,
  optionalTrimmedString,
} from '../../common/resource.dto';

const nullableDate = Transform(({ value }: { value: unknown }) =>
  value === '' ? null : value,
);

export class AttractionQueryDto extends ResourceQueryDto {
  @IsOptional() @optionalTrimmedString @IsString() area?: string;
  @IsOptional() @IsIn(ATTRACTION_CATEGORIES) category?: AttractionCategory;
  @IsOptional() @optionalTrimmedString @IsString() unit?: string;
}
export class CreateAttractionDto extends ResourceInputDto {
  @optionalTrimmedString @IsString() @MaxLength(100) area: string;
  @IsIn(ATTRACTION_CATEGORIES) category: AttractionCategory;
  @optionalTrimmedString @IsString() @MaxLength(500) restroomLocation: string;
  @optionalTrimmedString @IsString() remark: string;
  @optionalTrimmedString @IsString() @MaxLength(100) unit: string;
}
export class UpdateAttractionDto extends CreateAttractionDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
export class CreateAttractionPriceDto {
  @IsOptional() @IsUUID('all') id?: string;
  @IsIn(ATTRACTION_PRICE_ITEM_TYPES) itemType: AttractionPriceItemType;
  @optionalTrimmedString @IsString() @MaxLength(150) itemName: string;
  @optionalTrimmedString @IsString() @MaxLength(100) audience: string;
  @optionalTrimmedString @IsString() @MaxLength(100) periodName: string;
  @IsOptional()
  @nullableDate
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string | null;
  @IsOptional()
  @nullableDate
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string | null;
  @moneyTransform @Matches(/^\d{1,10}(?:\.\d{1,2})?$/) rackPrice: string;
  @moneyTransform
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  settlementPrice: string;
  @optionalTrimmedString @IsString() @MaxLength(100) unit: string;
  @IsBoolean() isFree: boolean;
  @optionalTrimmedString @IsString() priceNote: string;
}
export class UpdateAttractionPriceDto extends CreateAttractionPriceDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
export class AttractionPriceResponse implements ResourceAuditResponse {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  attractionId: string;
  itemType: AttractionPriceItemType;
  itemName: string;
  audience: string;
  periodName: string;
  startDate: string | null;
  endDate: string | null;
  rackPrice: string;
  settlementPrice: string;
  unit: string;
  isFree: boolean;
  priceNote: string;
}
export class AttractionListItemResponse implements ResourceAuditResponse {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  code: string;
  name: string;
  area: string;
  category: AttractionCategory;
  restroomLocation: string;
  remark: string;
  unit: string;
  status: string;
  priceCount: number;
}
export class AttractionDetailResponse extends AttractionListItemResponse {
  prices: AttractionPriceResponse[];
}
