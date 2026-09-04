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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { BatchIdsQueryDto } from '../common/resource.dto';
import {
  CreateRestaurantDto,
  CreateRestaurantPriceDto,
  RestaurantDetailResponse,
  RestaurantPriceResponse,
  RestaurantQueryDto,
  UpdateRestaurantDto,
  UpdateRestaurantPriceDto,
} from './dto/restaurant.dto';
import { RestaurantsService } from './restaurants.service';
@ApiTags('Resources')
@ApiBearerAuth()
@Controller('resources/restaurants')
export class RestaurantsController {
  constructor(private readonly service: RestaurantsService) {}
  @Get()
  @Permissions('resource:restaurant:list')
  @ApiOperation({ summary: 'List restaurants' })
  list(@Query() query: RestaurantQueryDto) {
    return this.service.list(query);
  }
  @Get(':restaurantId/prices')
  @Permissions('resource:restaurant:list')
  @ApiOperation({ summary: 'List restaurant prices' })
  @ApiOkResponse({ type: [RestaurantPriceResponse] })
  listPrices(
    @Param('restaurantId', new ParseUUIDPipe())
    restaurantId: string,
  ) {
    return this.service.listPrices(restaurantId);
  }
  @Post(':restaurantId/prices')
  @Permissions('resource:restaurant:create')
  @ApiOperation({ summary: 'Create a restaurant price' })
  @ApiCreatedResponse({ type: RestaurantPriceResponse })
  createPrice(
    @Param('restaurantId', new ParseUUIDPipe())
    restaurantId: string,
    @Body() input: CreateRestaurantPriceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createPrice(restaurantId, input, user.id);
  }
  @Put(':restaurantId/prices/:priceId')
  @Permissions('resource:restaurant:update')
  @ApiOperation({ summary: 'Update a restaurant price' })
  @ApiOkResponse({ type: RestaurantPriceResponse })
  updatePrice(
    @Param('restaurantId', new ParseUUIDPipe())
    restaurantId: string,
    @Param('priceId', new ParseUUIDPipe()) priceId: string,
    @Body() input: UpdateRestaurantPriceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updatePrice(restaurantId, priceId, input, user.id);
  }
  @Delete(':restaurantId/prices')
  @Permissions('resource:restaurant:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete restaurant prices' })
  @ApiNoContentResponse()
  deletePrices(
    @Param('restaurantId', new ParseUUIDPipe())
    restaurantId: string,
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.deletePrices(restaurantId, query.ids, user.id);
  }
  @Get(':id')
  @Permissions('resource:restaurant:list')
  @ApiOperation({ summary: 'Get a restaurant' })
  @ApiOkResponse({ type: RestaurantDetailResponse })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }
  @Post()
  @Permissions('resource:restaurant:create')
  @ApiOperation({ summary: 'Create a restaurant' })
  @ApiCreatedResponse({ type: RestaurantDetailResponse })
  create(
    @Body() input: CreateRestaurantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }
  @Put(':id')
  @Permissions('resource:restaurant:update')
  @ApiOperation({ summary: 'Update a restaurant' })
  @ApiOkResponse({ type: RestaurantDetailResponse })
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
