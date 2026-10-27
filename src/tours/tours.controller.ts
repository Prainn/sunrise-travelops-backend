import type { Request } from 'express';
import type { GuideServiceChange } from './tour-guide-services';
type TourAuditRequest = Request & {
  tourGuideServiceChange?: GuideServiceChange;
};
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  ApiCommonErrorResponses,
  ApiPaginatedResponse,
} from '../common/swagger/api-response.decorator';
import { BatchIdsQueryDto } from '../resources/common/resource.dto';
import { GuideLeavesService } from './guide-leaves.service';
import {
  CancelTourDto,
  TourFilterOptionsQueryDto,
  CreateTourDto,
  LeaveInputDto,
  LeaveQueryDto,
  RatingQueryDto,
  RatingScoreDto,
  TourFlightQueryDto,
  TourFlightOptionResponse,
  TourOperatorQueryDto,
  TourGuideQueryDto,
  TourLanguageQueryDto,
  TourQueryDto,
  TourSourceQueryDto,
  UpdateLeaveDto,
  UpdateTourDto,
} from './tour.dto';
import { ToursService } from './tours.service';

@ApiTags('Tours')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('tours')
export class ToursController {
  constructor(private readonly service: ToursService) {}

  @Get()
  @Permissions('tour:list')
  list(@Query() query: TourQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(query, user);
  }

  @Get('filter-options')
  @Permissions('tour:list')
  filterOptions(
    @Query() query: TourFilterOptionsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.filterOptions(query, actor);
  }

  @Get('sources')
  @Permissions('tour:create')
  sources(
    @Query() query: TourSourceQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.sources(query, user);
  }

  @Get('operators')
  @Permissions('tour:list')
  operators(
    @Query() query: TourOperatorQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.operators(query.businessUnit, user);
  }

  @Get('flights')
  @Permissions('tour:list')
  @ApiOperation({ summary: 'Search selectable flights with pagination' })
  @ApiPaginatedResponse(TourFlightOptionResponse)
  flights(
    @Query() query: TourFlightQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.flights(query, user);
  }

  @Get('guide-languages')
  @Permissions('tour:list')
  guideLanguages(
    @Query() query: TourLanguageQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.guideLanguages(query, user);
  }

  @Post('available-guides')
  @HttpCode(200)
  @Permissions('tour:list')
  availableGuides(
    @Body() query: TourGuideQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.availableGuides(query, user);
  }

  @Get('ratings')
  @Permissions('tour:rating:list')
  ratings(
    @Query() query: RatingQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.ratings(query, user);
  }

  @Put(':id/ratings/:guideId')
  @Permissions('tour:rating:update')
  saveRating(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('guideId', new ParseUUIDPipe()) guideId: string,
    @Body() input: RatingScoreDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveRating(id, guideId, input, user);
  }

  @Get(':id')
  @Permissions('tour:list')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.get(id, user);
  }

  @Post()
  @Permissions('tour:create')
  create(
    @Body() input: CreateTourDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: TourAuditRequest,
  ) {
    return this.service.create(input, user, (change) => {
      request.tourGuideServiceChange = change;
    });
  }

  @Put(':id')
  @Permissions('tour:update')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateTourDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: TourAuditRequest,
  ) {
    return this.service.update(id, input, user, (change) => {
      request.tourGuideServiceChange = change;
    });
  }

  @Post(':id/cancel')
  @Permissions('tour:cancel')
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: CancelTourDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.cancel(id, input, user);
  }
}

@ApiTags('Resources')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('resources/guide-leaves')
export class GuideLeavesController {
  constructor(private readonly service: GuideLeavesService) {}

  @Get()
  @Permissions('resource:guide:list')
  list(@Query() query: LeaveQueryDto) {
    return this.service.list(query);
  }

  @Post()
  @Permissions('resource:guide:create')
  create(@Body() input: LeaveInputDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(input, user.id);
  }

  @Put(':id')
  @Permissions('resource:guide:update')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateLeaveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }

  @Delete()
  @Permissions('resource:guide:delete')
  async delete(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.delete(query.ids, user.id);
  }
}
