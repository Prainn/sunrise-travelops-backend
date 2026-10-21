import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDefined,
  IsObject,
  MinLength,
  ValidateNested,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const UNITS = ['shengxu', 'linxi', 'website'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class TourScheduleDto {
  @IsIn(['flight', 'manual']) scheduleMode?: 'flight' | 'manual' = 'flight';
  @ValidateIf(
    (o: TourScheduleDto) =>
      o.scheduleMode === 'flight' || o.pickupFlightId !== undefined,
  )
  @IsUUID()
  pickupFlightId?: string;
  @ValidateIf(
    (o: TourScheduleDto) =>
      o.scheduleMode === 'flight' || o.dropFlightId !== undefined,
  )
  @IsUUID()
  dropFlightId?: string;
  @ValidateIf(
    (o: TourScheduleDto) =>
      o.scheduleMode === 'manual' || o.pickupAt !== undefined,
  )
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d$/)
  pickupAt?: string;
  @ValidateIf(
    (o: TourScheduleDto) =>
      o.scheduleMode === 'manual' || o.dropAt !== undefined,
  )
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d$/)
  dropAt?: string;
}

export class ManualTourSourceDto {
  @IsIn(UNITS) businessUnit: (typeof UNITS)[number];
  @IsUUID() countryItemId: string;
  @IsUUID() collectCoordinatorId: string;
  @IsOptional() @IsUUID() agencyId?: string;
  @Transform(trim) @IsString() @MaxLength(200) contactName = '';
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  itinerarySummary: string;
  @IsDateString({ strict: true }) @Matches(DATE) startDate: string;
  @IsInt() @Min(1) @Max(365) days: number;
}

export class TourInputDto extends TourScheduleDto {
  @IsUUID() operatorId: string;
  @IsInt() @Min(0) @Max(10000) adults: number;
  @IsInt() @Min(0) @Max(10000) children: number;
  @IsInt() @Min(0) @Max(10000) leaders: number;
  @Transform(trim) @IsString() @MaxLength(100) language = '';
  @IsBoolean() shopping: boolean;
  @IsOptional() @IsUUID() guideId?: string | null;
  @Transform(trim) @IsString() @MaxLength(2000) remark = '';
}

export class CreateTourDto extends TourInputDto {
  @IsIn(['standard', 'website', 'manual']) sourceModule:
    'standard' | 'website' | 'manual';
  @ValidateIf(
    (o: CreateTourDto) =>
      o.sourceModule !== 'manual' || o.inquiryId !== undefined,
  )
  @IsUUID()
  inquiryId?: string;
  @ValidateIf(
    (o: CreateTourDto) =>
      o.sourceModule !== 'manual' || o.quoteId !== undefined,
  )
  @IsUUID()
  quoteId?: string;
  @ValidateIf(
    (o: CreateTourDto) =>
      o.sourceModule === 'manual' || o.manualSource !== undefined,
  )
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ManualTourSourceDto)
  manualSource?: ManualTourSourceDto;
}

export class UpdateTourDto extends TourInputDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => ManualTourSourceDto)
  manualSource?: ManualTourSourceDto;
  @IsInt() @Min(1) version: number;
}

export class CancelTourDto {
  @IsInt() @Min(1) version: number;
  @Transform(trim) @IsString() @MaxLength(500) reason = '';
}

export class TourFilterOptionsQueryDto extends PaginationQueryDto {
  @IsIn(['collectCoordinator', 'operator', 'agency']) kind!:
    'collectCoordinator' | 'operator' | 'agency';
  @IsOptional() @IsIn(UNITS) businessUnit?: (typeof UNITS)[number];
  @IsOptional() @IsString() @MaxLength(200) declare keyword?: string;
}
export class TourQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() collectCoordinatorId?: string;
  @IsOptional() @IsUUID() operatorId?: string;
  @IsOptional() @IsString() @MaxLength(200) agencyName?: string;
  @IsOptional() @IsIn(UNITS) businessUnit?: (typeof UNITS)[number];
  @IsOptional() @IsIn(['active', 'cancelled']) status?: string;
  @IsOptional() @IsUUID() guideId?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(DATE) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(DATE) to?: string;
}

export class TourSourceQueryDto {
  @IsIn(['standard', 'website']) sourceModule: 'standard' | 'website';
  @IsOptional() @IsString() @MaxLength(100) keyword?: string;
}

export class TourOperatorQueryDto {
  @IsIn(UNITS) businessUnit: (typeof UNITS)[number];
}

export class TourFlightQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  declare page: number;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  declare pageSize: number;
  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare keyword?: string;
  @ApiPropertyOptional({
    enum: UNITS,
    description:
      'Required for headquarters; otherwise defaults to the current business scope',
  })
  @IsOptional()
  @IsIn(UNITS)
  businessUnit?: (typeof UNITS)[number];
}

export class TourFlightOptionResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() flightNumber: string;
  @ApiProperty() departureTime: string;
  @ApiProperty() arrivalTime: string;
  @ApiProperty() departureCode: string;
  @ApiProperty() departureName: string;
  @ApiProperty() departureEnglishName: string;
  @ApiProperty() arrivalCode: string;
  @ApiProperty() arrivalName: string;
  @ApiProperty() arrivalEnglishName: string;
}

export class TourLanguageQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(100) declare keyword?: string;
}

export class TourGuideQueryDto extends TourScheduleDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) language: string;
  @IsIn(UNITS) businessUnit: (typeof UNITS)[number];
  @IsDateString({ strict: true }) @Matches(DATE) startDate: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(365) days: number;
  @IsOptional() @IsUUID() excludeTourId?: string;
}

export class RatingScoreDto {
  @IsInt() @Min(0) version: number;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  selfScore?: number | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  managerScore?: number | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  collectScore?: number | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  operatorScore?: number | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  carPurchase?: number | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  recommendedSelfPay?: number | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  praise?: number | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  designated?: number | null;
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  incident?: number | null;
}

export class RatingQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() guideId?: string;
}

export class LeaveInputDto {
  @IsUUID() guidePersonId: string;
  @IsDateString({ strict: true }) @Matches(DATE) startDate: string;
  @IsDateString({ strict: true }) @Matches(DATE) endDate: string;
  @Transform(trim) @IsString() @MaxLength(200) reason = '';
  @Transform(trim) @IsString() @MaxLength(2000) remark = '';
}

export class UpdateLeaveDto extends LeaveInputDto {
  @IsInt() @Min(1) version: number;
}

export class LeaveQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() guidePersonId?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(DATE) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(DATE) to?: string;
}
