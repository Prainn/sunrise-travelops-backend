import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { COORDINATOR_DUTIES, CoordinatorDuty } from '../coordinator-assignment';

export class BusinessGroupQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['enabled', 'disabled'] })
  @IsOptional()
  @IsIn(['enabled', 'disabled'])
  status?: 'enabled' | 'disabled';
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare keyword?: string;
}
export class CreateBusinessGroupDto {
  @ApiProperty({ maxLength: 100, example: '定制师杨娟组' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}
export class UpdateBusinessGroupDto extends CreateBusinessGroupDto {
  @ApiProperty({ enum: ['enabled', 'disabled'] })
  @IsIn(['enabled', 'disabled'])
  status: 'enabled' | 'disabled';
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version: number;
}
export class UpdateCoordinatorDutyDto {
  @ApiProperty({ enum: COORDINATOR_DUTIES })
  @IsIn(COORDINATOR_DUTIES)
  coordinatorDuty: CoordinatorDuty;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version: number;
}
export class UpdateUserBusinessGroupDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() businessGroupId: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version: number;
}
