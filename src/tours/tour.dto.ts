import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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

export class TourInputDto {
  @IsUUID() operatorId: string;
  @IsInt() @Min(0) @Max(10000) adults: number;
  @IsInt() @Min(0) @Max(10000) children: number;
  @IsInt() @Min(0) @Max(10000) leaders: number;
  @Transform(trim) @IsString() @MaxLength(100) language = '';
  @IsBoolean() shopping: boolean;
  @IsUUID() pickupFlightId: string;
  @IsUUID() dropFlightId: string;
  @IsOptional() @IsUUID() guideId?: string | null;
  @Transform(trim) @IsString() @MaxLength(2000) remark = '';
}

export class CreateTourDto extends TourInputDto {
  @IsIn(['standard', 'website']) sourceModule: 'standard' | 'website';
  @IsUUID() inquiryId: string;
  @IsUUID() quoteId: string;
}

export class UpdateTourDto extends TourInputDto {
  @IsInt() @Min(1) version: number;
}

export class CancelTourDto {
  @IsInt() @Min(1) version: number;
  @Transform(trim) @IsString() @MaxLength(500) reason = '';
}

export class TourQueryDto extends PaginationQueryDto {
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

export class TourFlightQueryDto {
  @IsOptional() @IsString() @MaxLength(100) keyword?: string;
  @IsOptional() @IsIn(UNITS) businessUnit?: (typeof UNITS)[number];
}

export class TourGuideQueryDto {
  @IsIn(UNITS) businessUnit: (typeof UNITS)[number];
  @IsDateString({ strict: true }) @Matches(DATE) startDate: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(365) days: number;
  @IsUUID() pickupFlightId: string;
  @IsUUID() dropFlightId: string;
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
  @IsOptional() @IsIn(['shengxu', 'shared']) library?: 'shengxu' | 'shared';
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
  @IsOptional() @IsIn(UNITS) businessUnit?: (typeof UNITS)[number];
  @IsOptional() @IsIn(['shengxu', 'shared']) library?: 'shengxu' | 'shared';
  @IsOptional() @IsUUID() guidePersonId?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(DATE) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(DATE) to?: string;
}
