import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn } from 'class-validator';

export class DashboardTrendQuery {
  @ApiPropertyOptional({ enum: [7, 30], default: 7 })
  @Type(() => Number)
  @IsIn([7, 30])
  days: 7 | 30 = 7;
}

export class InquiryStatusCounts {
  @ApiProperty({ type: 'integer', minimum: 0 })
  new: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  planning: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  quoted: number;
}

export class TourCounts {
  @ApiProperty({ type: 'integer', minimum: 0 })
  active: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  departingThisWeek: number;
}

export class DashboardSummary {
  @ApiProperty({ type: () => InquiryStatusCounts, nullable: true })
  inquiries: InquiryStatusCounts | null;

  @ApiProperty({ type: () => InquiryStatusCounts, nullable: true })
  websiteInquiries: InquiryStatusCounts | null;

  @ApiProperty({ type: () => TourCounts, nullable: true })
  tours: TourCounts | null;

  @ApiProperty({ type: 'integer', minimum: 0, nullable: true })
  guideLeavesToday: number | null;
}

export class DashboardTrend {
  @ApiProperty({ type: [String], example: ['2026-10-19'] })
  dates: string[];

  @ApiProperty({
    type: 'array',
    items: { type: 'integer', minimum: 0 },
    nullable: true,
    description:
      '可访问的普通及独立站询盘按创建日合计；两来源均不可访问时为 null',
  })
  newInquiries: number[] | null;

  @ApiProperty({
    type: 'array',
    items: { type: 'integer', minimum: 0 },
    nullable: true,
  })
  departingTours: number[] | null;
}
