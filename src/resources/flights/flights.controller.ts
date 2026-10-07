import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import {
  ApiCommonErrorResponses,
  ApiPaginatedResponse,
  ApiSuccessResponse,
} from '../../common/swagger/api-response.decorator';
import { BatchIdsQueryDto } from '../common/resource.dto';
import { ResourceScopeInterceptor } from '../common/resource-scope';
import {
  CreateFlightDto,
  FlightQueryDto,
  FlightResponse,
  UpdateFlightDto,
} from './dto/flight.dto';
import { FlightsService } from './flights.service';

@ApiTags('Resources')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@UseInterceptors(ResourceScopeInterceptor)
@Controller('resources/flights')
export class FlightsController {
  constructor(private readonly service: FlightsService) {}

  @Get()
  @Permissions('resource:flight:list')
  @ApiOperation({ summary: 'List flights' })
  @ApiPaginatedResponse(FlightResponse)
  list(@Query() query: FlightQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Permissions('resource:flight:list')
  @ApiOperation({ summary: 'Get a flight' })
  @ApiSuccessResponse({ type: FlightResponse })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }

  @Post()
  @Permissions('resource:flight:create')
  @ApiOperation({ summary: 'Create a flight' })
  @ApiSuccessResponse({ status: HttpStatus.CREATED, type: FlightResponse })
  create(
    @Body() input: CreateFlightDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Put(':id')
  @Permissions('resource:flight:update')
  @ApiOperation({ summary: 'Update a flight' })
  @ApiSuccessResponse({ type: FlightResponse })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateFlightDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }

  @Delete()
  @Permissions('resource:flight:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete flights' })
  @ApiNoContentResponse()
  delete(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.delete(query.ids, user.id);
  }
}
