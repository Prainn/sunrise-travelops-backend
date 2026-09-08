import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ResourceAuditResponse,
  ResourceInputDto,
  ResourceQueryDto,
  moneyTransform,
  optionalTrimmedString,
} from '../../common/resource.dto';

export class RestaurantQueryDto extends ResourceQueryDto {
  @IsOptional() @optionalTrimmedString @IsString() city?: string;
  @IsOptional() @optionalTrimmedString @IsString() unit?: string;
}
export class CreateRestaurantDto extends ResourceInputDto {
  @optionalTrimmedString @IsString() @MaxLength(100) city: string;
  @optionalTrimmedString @IsString() @MaxLength(100) cuisine: string;
  @optionalTrimmedString @IsString() @MaxLength(100) contact: string;
  @optionalTrimmedString @IsString() @MaxLength(50) phone: string;
  @optionalTrimmedString @IsString() @MaxLength(500) address: string;
  @optionalTrimmedString @IsString() remark: string;
  @optionalTrimmedString @IsString() @MaxLength(100) unit: string;
}
export class UpdateRestaurantDto extends CreateRestaurantDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
export class CreateRestaurantPriceDto {
  @IsOptional() @IsUUID('all') id?: string;
  @optionalTrimmedString @IsString() @MaxLength(150) menuName: string;
  @optionalTrimmedString @IsString() dishDetails: string;
  @optionalTrimmedString @IsString() @MaxLength(100) unit: string;
  @moneyTransform @Matches(/^\d{1,10}(?:\.\d{1,2})?$/) price: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) dinerCount?: number | null;
  @optionalTrimmedString @IsString() remark: string;
}
export class UpdateRestaurantPriceDto extends CreateRestaurantPriceDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
export class RestaurantPriceResponse implements ResourceAuditResponse {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  restaurantId: string;
  menuName: string;
  dishDetails: string;
  unit: string;
  price: string;
  dinerCount: number | null;
  remark: string;
}
export class RestaurantListItemResponse implements ResourceAuditResponse {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  code: string;
  name: string;
  city: string;
  cuisine: string;
  contact: string;
  phone: string;
  address: string;
  remark: string;
  unit: string;
  status: string;
  priceCount: number;
}
export class RestaurantDetailResponse extends RestaurantListItemResponse {
  prices: RestaurantPriceResponse[];
}
