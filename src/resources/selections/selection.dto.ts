import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { OmitType } from '@nestjs/swagger';
import {
  RestaurantListItemResponse,
  RestaurantPriceResponse,
} from '../restaurants/dto/restaurant.dto';
import {
  AttractionListItemResponse,
  AttractionPriceResponse,
} from '../attractions/dto/attraction.dto';
export class SelectionQuery {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 10;
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() rating?: string;
  @IsOptional() @IsString() serviceLevel?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) guestCount?: number;
}

export class PriceOptionResponse {
  id: string;
  resourceId: string;
  resourceName: string;
  priceName: string;
  city: string;
  unit: string;
  unitCost: string;
}
export class ResourceOptionResponse {
  id: string;
  name: string;
  unitCost?: string;
  code?: string;
  breakfastIncluded?: boolean;
  seats?: number;
  city?: string;
}
class RestaurantSelectionResource extends OmitType(RestaurantListItemResponse, [
  'priceCount',
] as const) {}
class AttractionSelectionResource extends OmitType(AttractionListItemResponse, [
  'priceCount',
] as const) {}
export class RestaurantSelectionResponse {
  resource: RestaurantSelectionResource;
  price: RestaurantPriceResponse;
}
export class AttractionSelectionResponse {
  resource: AttractionSelectionResource;
  price: AttractionPriceResponse;
}
