import { Type } from 'class-transformer';
import {
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

export class TransportQueryDto extends ResourceQueryDto {
  @IsOptional() @optionalTrimmedString @IsString() city?: string;
  @IsOptional()
  @optionalTrimmedString
  @IsIn(['standard', 'vip'])
  serviceLevel?: string;
  @IsOptional() @optionalTrimmedString @IsString() unit?: string;
}
export class CreateTransportDto extends ResourceInputDto {
  @IsIn(['standard', 'vip']) serviceLevel: string;
  @Type(() => Number) @IsInt() @Min(1) seats: number;
  @moneyTransform @Matches(/^\d{1,10}(?:\.\d{1,2})?$/) dailyPrice: string;
  @optionalTrimmedString @IsString() @MaxLength(100) unit: string;
  @optionalTrimmedString @IsString() @MaxLength(100) city: string;
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
  dailyPrice: string;
  unit: string;
  city: string;
  phone: string;
  status: string;
  remark: string;
}
export class TransportListItemResponse extends TransportResponse {}
export class TransportDetailResponse extends TransportResponse {}
