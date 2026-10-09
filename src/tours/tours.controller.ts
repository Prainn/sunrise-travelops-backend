import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ApiCommonErrorResponses } from '../common/swagger/api-response.decorator';
import { BatchIdsQueryDto } from '../resources/common/resource.dto';
import { ResourceScopeInterceptor } from '../resources/common/resource-scope';
import { GuideLeavesService } from './guide-leaves.service';
import {
  CancelTourDto,
  CreateTourDto,
  LeaveInputDto,
  LeaveQueryDto,
  RatingQueryDto,
  RatingScoreDto,
  TourFlightQueryDto,
  TourOperatorQueryDto,
  TourGuideQueryDto,
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
  flights(
    @Query() query: TourFlightQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.flights(query, user);
  }

  @Get('available-guides')
  @Permissions('tour:list')
  availableGuides(
    @Query() query: TourGuideQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.availableGuides(query, user);
  }

  @Get('ratings')
  @Permissions('tour:list')
  ratings(
    @Query() query: RatingQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.ratings(query, user);
  }

  @Put('ratings/:id')
  @Permissions('tour:rating:update')
  saveRating(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RatingScoreDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveRating(id, input, user);
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
  create(@Body() input: CreateTourDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(input, user);
  }

  @Put(':id')
  @Permissions('tour:update')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateTourDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user);
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
@UseInterceptors(ResourceScopeInterceptor)
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
