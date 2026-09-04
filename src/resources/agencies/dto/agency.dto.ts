import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  ResourceQueryDto,
  ResourceAuditResponse,
  ResourceInputDto,
  optionalTrimmedString,
} from '../../common/resource.dto';

export class AgencyQueryDto extends ResourceQueryDto {}

export class CreateAgencyDto extends ResourceInputDto {
  @optionalTrimmedString @IsString() @MaxLength(100) city: string;
  @optionalTrimmedString @IsString() @MaxLength(100) countryOrRegion: string;
  @optionalTrimmedString
  @ValidateIf((_input: CreateAgencyDto, value: unknown) => value !== '')
  @IsEmail()
  @MaxLength(254)
  email: string;
  @optionalTrimmedString @IsString() remark: string;
}

export class UpdateAgencyDto extends CreateAgencyDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}

export class CreateAgencyContactDto {
  @IsOptional() @IsUUID('all') id?: string;
  @optionalTrimmedString
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
  @optionalTrimmedString @IsString() @MaxLength(50) phone: string;
}

export class UpdateAgencyContactDto extends CreateAgencyContactDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}

export class AgencyContactResponse implements ResourceAuditResponse {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  agencyId: string;
  name: string;
  phone: string;
}

export class AgencyListItemResponse implements ResourceAuditResponse {
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
  email: string;
  status: string;
  remark: string;
  contactCount: number;
}

export class AgencyDetailResponse extends AgencyListItemResponse {
  contacts: AgencyContactResponse[];
}
