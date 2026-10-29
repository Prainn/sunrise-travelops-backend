import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class InspectionAlertDto {
  @ApiProperty({
    format: 'uuid',
    description: '同一异常生命周期使用同一标识；新异常使用新标识',
  })
  @IsUUID()
  eventId: string;

  @ApiProperty({ example: '2026-10-28T10:00:00+08:00' })
  @MaxLength(35)
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  checkedAt: string;

  @ApiProperty({ enum: ['production', 'development'] })
  @IsIn(['production', 'development'])
  environment: 'production' | 'development';

  @ApiProperty({ enum: ['abnormal', 'normal', 'recovered'] })
  @IsIn(['abnormal', 'normal', 'recovered'])
  status: 'abnormal' | 'normal' | 'recovered';

  @ApiProperty({ enum: ['warning', 'critical'] })
  @IsIn(['warning', 'critical'])
  severity: 'warning' | 'critical';

  @ApiProperty({ enum: ['availability', 'disk', 'memory', 'cpu'] })
  @IsIn(['availability', 'disk', 'memory', 'cpu'])
  item: 'availability' | 'disk' | 'memory' | 'cpu';

  @ApiProperty({ description: '关键指标，百分比 0–100' })
  @IsInt()
  @Min(0)
  @Max(100)
  metricPercent: number;
}
