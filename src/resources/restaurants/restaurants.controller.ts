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
import {
  CreateRestaurantDto,
  RestaurantResponse,
  RestaurantQueryDto,
  UpdateRestaurantDto,
} from './dto/restaurant.dto';
import { RestaurantsService } from './restaurants.service';
@ApiTags('Resources')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('resources/restaurants')
export class RestaurantsController {
  constructor(private readonly service: RestaurantsService) {}
  @Get()
  @Permissions('resource:restaurant:list')
  @ApiOperation({ summary: 'List restaurants' })
  @ApiPaginatedResponse(RestaurantResponse)
  list(@Query() query: RestaurantQueryDto) {
    return this.service.list(query);
  }
  @Get(':id')
  @Permissions('resource:restaurant:list')
  @ApiOperation({ summary: 'Get a restaurant' })
  @ApiSuccessResponse({ type: RestaurantResponse })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }
  @Post()
  @Permissions('resource:restaurant:create')
  @ApiOperation({ summary: 'Create a restaurant' })
  @ApiSuccessResponse({
    status: HttpStatus.CREATED,
    type: RestaurantResponse,
  })
  create(
    @Body() input: CreateRestaurantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }
  @Put(':id')
  @Permissions('resource:restaurant:update')
  @ApiOperation({ summary: 'Update a restaurant' })
  @ApiSuccessResponse({ type: RestaurantResponse })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateRestaurantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }
  @Delete()
  @Permissions('resource:restaurant:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete restaurants' })
  @ApiNoContentResponse()
  delete(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.delete(query.ids, user.id);
  }
}
