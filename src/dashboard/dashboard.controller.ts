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
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ToursService } from '../tours/tours.service';
import { TourMapQuery, TourMapResponse } from '../tours/tour-map.dto';
import { FlightMapQuery, FlightMapResponse } from '../tours/flight-map.dto';

@ApiTags('Dashboard')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly service: DashboardService,
    private readonly tours: ToursService,
  ) {}

  @Get('flight-map')
  @Permissions('tour:list')
  @ApiOperation({ summary: '当前成团可见范围内的按日航班航线演示数据' })
  @ApiSuccessResponse({ type: FlightMapResponse })
  flightMap(
    @Query() query: FlightMapQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tours.flightMap(query, user);
  }

  @Get('tour-map')
  @Permissions('tour:list')
  @ApiOperation({ summary: '当前成团可见范围内的云南计划位置与团务地图' })
  @ApiSuccessResponse({ type: TourMapResponse })
  tourMap(
    @Query() query: TourMapQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tours.map(query, user);
  }

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
