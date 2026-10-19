import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  ApiCommonErrorResponses,
  ApiSuccessResponse,
} from '../common/swagger/api-response.decorator';
import {
  DashboardSummary,
  DashboardTrend,
  DashboardTrendQuery,
} from './dashboard.dto';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  // Global JWT authentication applies. Each source is gated separately by the service.
  @Get('summary')
  @ApiOperation({ summary: '当前身份可见业务统计，无权项返回 null' })
  @ApiSuccessResponse({ type: DashboardSummary })
  summary(@CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    return this.service.summary(user, request);
  }

  @Get('trend')
  @ApiOperation({ summary: 'Asia/Shanghai 最近7或30个自然日业务趋势' })
  @ApiSuccessResponse({ type: DashboardTrend })
  trend(
    @Query() query: DashboardTrendQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.service.trend(query.days, user, request);
  }
}
