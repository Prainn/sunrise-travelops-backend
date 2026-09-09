import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
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

export class HotelQueryDto extends ResourceQueryDto {
  @IsOptional() @optionalTrimmedString @IsString() city?: string;
  @IsOptional()
  @optionalTrimmedString
  @IsIn(['international_five_star', 'ctrip_preferred'])
  rating?: string;
  @IsOptional() @optionalTrimmedString @IsString() unit?: string;
}
export class CreateHotelDto extends ResourceInputDto {
  @optionalTrimmedString @IsString() @MaxLength(100) province: string;
  @optionalTrimmedString @IsString() @MaxLength(100) city: string;
  @IsIn(['international_five_star', 'ctrip_preferred']) rating: string;
  @optionalTrimmedString @IsString() facilities: string;
  @IsBoolean() breakfastIncluded: boolean = true;
  @optionalTrimmedString @IsString() breakfast: string;
  @optionalTrimmedString @IsString() @MaxLength(500) address: string;
  @optionalTrimmedString @IsString() @MaxLength(50) phone: string;
  @optionalTrimmedString @IsString() nearby: string;
  @moneyTransform @Matches(/^\d{1,10}(?:\.\d{1,2})?$/) individualPrice: string;
  @IsOptional()
  @moneyTransform
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  groupPrice?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) minimumGroupSize?:
    number | null;
  @optionalTrimmedString @IsString() @MaxLength(100) unit: string;
}
export class UpdateHotelDto extends CreateHotelDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
export class HotelResponse implements ResourceAuditResponse {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  code: string;
  name: string;
  province: string;
  city: string;
  rating: string;
  facilities: string;
  breakfastIncluded: boolean;
  breakfast: string;
  address: string;
  phone: string;
  nearby: string;
  individualPrice: string;
  groupPrice: string | null;
  minimumGroupSize: number | null;
  unit: string;
  status: string;
}
export class HotelListItemResponse extends HotelResponse {}
export class HotelDetailResponse extends HotelResponse {}
