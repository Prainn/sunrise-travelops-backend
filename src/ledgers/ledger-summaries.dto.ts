import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const SUMMARY_REPORTS = [
  'shengxu-agency-summary',
  'shengxu-coordinator-summary',
  'linxi-quote-summary',
  'linxi-platform-summary',
  'website-quote-summary',
  'website-platform-summary',
] as const;
export type SummaryReport = (typeof SUMMARY_REPORTS)[number];
export class SummaryReportParamsDto {
  @ApiProperty({ enum: SUMMARY_REPORTS })
  @IsIn(SUMMARY_REPORTS)
  report!: SummaryReport;
}
export class SummaryRowParamsDto extends SummaryReportParamsDto {
  @ApiProperty() @IsUUID() id!: string;
}
export class SummaryQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to?: string;
}
export class SummaryNotesDto {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  firstFollowUp?: string;
  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @MaxLength(5000)
  tourNumbers!: string;
}
