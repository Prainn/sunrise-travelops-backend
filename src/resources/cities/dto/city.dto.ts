import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import {
  ResourceInputDto,
  ResourceQueryDto,
  ResourceAuditResponse,
  optionalTrimmedString,
} from '../../common/resource.dto';
export class CityQueryDto extends ResourceQueryDto {}
export class CreateCityDto extends ResourceInputDto {
  @MaxLength(100) declare name: string;
  @optionalTrimmedString @IsString() @MaxLength(100) province: string = '';
}
export class UpdateCityDto extends CreateCityDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
export class CityResponse implements ResourceAuditResponse {
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
