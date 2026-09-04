import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  ResourceAuditResponse,
  ResourceInputDto,
  ResourceQueryDto,
  optionalTrimmedString,
} from '../../common/resource.dto';

export class SupplierQueryDto extends ResourceQueryDto {}
export class CreateSupplierDto extends ResourceInputDto {
  @optionalTrimmedString @IsString() @MaxLength(100) city: string;
  @optionalTrimmedString @IsString() @MaxLength(100) countryOrRegion: string;
  @optionalTrimmedString @IsString() @MaxLength(100) contact: string;
  @optionalTrimmedString
  @ValidateIf((_input: CreateSupplierDto, value: unknown) => value !== '')
  @IsEmail()
  @MaxLength(254)
  email: string;
  @optionalTrimmedString @IsString() @MaxLength(50) phone: string;
  @optionalTrimmedString @IsString() remark: string;
}
export class UpdateSupplierDto extends CreateSupplierDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
export class SupplierResponse implements ResourceAuditResponse {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  code: string;
  name: string;
  city: string;
  countryOrRegion: string;
  contact: string;
  email: string;
  phone: string;
  status: string;
  remark: string;
}
export class SupplierListItemResponse extends SupplierResponse {}
export class SupplierDetailResponse extends SupplierResponse {}
export class SupplierOptionResponse {
  id: string;
  code: string;
  name: string;
}
