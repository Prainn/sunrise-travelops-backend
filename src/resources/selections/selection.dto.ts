import { IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { RestaurantResponse } from '../restaurants/dto/restaurant.dto';
import { AttractionResponse } from '../attractions/dto/attraction.dto';
export class SelectionQuery {
  @IsOptional() @IsIn(['true', 'false']) parentOnly?: string;
  @IsOptional() @IsUUID('all') excludeId?: string;
  @IsOptional() @IsIn(['shengxu', 'linxi', 'website']) businessUnit?:
    'shengxu' | 'linxi' | 'website';
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 10;
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @Type(() => Number) @IsIn([3, 4, 5]) rating?: number;
  @IsOptional() @IsString() secondLanguage?: string;
  @IsOptional() @IsString() shopping?: string;
  @IsOptional() @IsString() serviceLevel?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) guestCount?: number;
}

export class PriceOptionResponse {
  isStandardPrice: boolean;
  id: string;
  resourceId: string;
  resourceName: string;
  city: string;
  unit: string;
  unitCost: string;
  dinerCount: number | null;
}
export class ResourceOptionResponse {
  id: string;
  name: string;
  unitCost?: string;
  code?: string;
  secondLanguage?: string;
  shopping?: boolean;
  seats?: number;
  city?: string;
}
export { RestaurantResponse, AttractionResponse };
