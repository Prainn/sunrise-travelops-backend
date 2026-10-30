import { Type } from 'class-transformer';
import {
  IsUUID,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ResourceInputDto,
  ResourceQueryDto,
  ResourceAuditResponse,
  optionalTrimmedString,
} from '../../common/resource.dto';
export class CityQueryDto extends ResourceQueryDto {}
export class CreateCityDto extends ResourceInputDto {
  @MaxLength(100) declare name: string;
  @optionalTrimmedString
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  province: string;
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;
}
export class UpdateCityDto extends CreateCityDto {
  @IsOptional() @IsUUID('all') id?: string;
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
export class CityResponse implements ResourceAuditResponse {
  longitude: number | null;
  latitude: number | null;
  id: string;
  code: string;
  name: string;
  province: string;
  status: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** Shared dropdown data; no audit identities or management metadata. */
export class CityOptionResponse {
  id: string;
  name: string;
  province: string;
  status: string;
}
