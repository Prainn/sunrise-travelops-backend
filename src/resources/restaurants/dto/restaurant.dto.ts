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
  ValidateIf,
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
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isStandardPrice?: boolean;
}
export class CreateRestaurantDto extends ResourceInputDto {
  @IsOptional()
  @optionalTrimmedString
  @IsString()
  @MaxLength(150)
  englishName?: string;
  @IsOptional() @optionalTrimmedString @IsString() englishDescription?: string;
  @optionalTrimmedString @IsString() @MinLength(1) @MaxLength(100) city: string;
  @optionalTrimmedString @IsString() @MinLength(1) description: string;
  @moneyTransform @Matches(/^\d{1,10}(?:\.\d{1,2})?$/) price: string;
  @IsIn(['personMeal', 'table']) unit: string;
  @ValidateIf((o: CreateRestaurantDto) => o.unit === 'table')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dinerCount?: number | null;
  @IsOptional()
  @optionalTrimmedString
  @IsString()
  @MaxLength(100)
  cuisine?: string;
  @IsOptional()
  @optionalTrimmedString
  @IsString()
  @MaxLength(100)
  contact?: string;
  @IsOptional()
  @optionalTrimmedString
  @IsString()
  @MaxLength(50)
  phone?: string;
  @IsOptional()
  @optionalTrimmedString
  @IsString()
  @MaxLength(500)
  address?: string;
  @IsOptional() @IsBoolean() isStandardPrice?: boolean;
  @IsOptional() @optionalTrimmedString @IsString() remark?: string;
}
export class UpdateRestaurantDto extends CreateRestaurantDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
export class RestaurantResponse implements ResourceAuditResponse {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  code: string;
  name: string;
  englishName: string;
  englishDescription: string;
  city: string;
  cuisine: string;
  contact: string;
  phone: string;
  address: string;
  description: string;
  isStandardPrice: boolean;
  remark: string;
  unit: string;
  /** Null for migrated records that still need a price. */
  price: string | null;
  dinerCount: number | null;
  status: string;
}
