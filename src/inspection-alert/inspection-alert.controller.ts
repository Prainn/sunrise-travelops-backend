import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { InspectionAlertDto } from './inspection-alert.dto';
import { InspectionAlertGuard } from './inspection-alert.guard';
import { InspectionAlertService } from './inspection-alert.service';

@ApiTags('巡检通知')
@Controller('inspection-alerts')
export class InspectionAlertController {
  constructor(private readonly service: InspectionAlertService) {}
  @Post()
  @HttpCode(200)
  @Public()
  @UseGuards(InspectionAlertGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '报告巡检异常（专用令牌）' })
  report(@Body() input: InspectionAlertDto) {
    return this.service.report(input);
  }
}
