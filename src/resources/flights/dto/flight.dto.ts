import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  optionalTrimmedString,
  ResourceAuditResponse,
  ResourceQueryDto,
} from '../../common/resource.dto';
import { ResourceStatus } from '../../common/resource.constants';

export class FlightQueryDto extends ResourceQueryDto {}

export class CreateFlightDto {
  @IsOptional() @IsIn(['shengxu', 'shared']) library?: 'shengxu' | 'shared';
  @IsOptional() @IsUUID('all') id?: string;

  @optionalTrimmedString
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  departureCity: string;

  @optionalTrimmedString
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  arrivalCity: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9]{1,20}$/)
  flightNumber: string;

  @ApiProperty({ example: '13:10', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' })
  @optionalTrimmedString
  @IsString()
  @Matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
  departureTime: string;

  @ApiProperty({ example: '16:55', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' })
  @optionalTrimmedString
  @IsString()
  @Matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
  arrivalTime: string;

  @IsEnum(ResourceStatus) status: ResourceStatus;
}

export class UpdateFlightDto extends CreateFlightDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}

export class FlightResponse implements ResourceAuditResponse {
  library: 'shengxu' | 'shared';
  id: string;
  departureCity: string;
  arrivalCity: string;
  flightNumber: string;
  departureTime: string;
  arrivalTime: string;
  status: ResourceStatus;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}
