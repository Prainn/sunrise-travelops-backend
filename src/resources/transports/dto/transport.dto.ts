import { Type } from 'class-transformer';
import {
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ResourceAuditResponse,
  ResourceInputDto,
  ResourceQueryDto,
  optionalTrimmedString,
} from '../../common/resource.dto';

export class TransportQueryDto extends ResourceQueryDto {
  @IsOptional()
  @optionalTrimmedString
  @IsIn(['standard', 'vip'])
  serviceLevel?: string;
  @IsOptional() @optionalTrimmedString @IsString() unit?: string;
}
export class CreateTransportDto extends ResourceInputDto {
  @IsIn(['standard', 'vip']) serviceLevel: string;
  @Type(() => Number) @IsInt() @Min(1) seats: number;
  @optionalTrimmedString @IsString() @MaxLength(100) unit: string;
  @optionalTrimmedString @IsString() @MaxLength(50) phone: string;
  @optionalTrimmedString @IsString() remark: string;
}
export class UpdateTransportDto extends CreateTransportDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}
export class TransportResponse implements ResourceAuditResponse {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  code: string;
  name: string;
  serviceLevel: string;
  seats: number;
  unit: string;
  phone: string;
  status: string;
  remark: string;
}
export class TransportListItemResponse extends TransportResponse {}
export class TransportDetailResponse extends TransportResponse {}
