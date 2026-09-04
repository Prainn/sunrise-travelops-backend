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
  AttractionDetailResponse,
  AttractionPriceResponse,
  AttractionQueryDto,
  CreateAttractionDto,
  CreateAttractionPriceDto,
  UpdateAttractionDto,
  UpdateAttractionPriceDto,
} from './dto/attraction.dto';
import { AttractionsService } from './attractions.service';
@ApiTags('Resources')
@ApiBearerAuth()
@Controller('resources/attractions')
export class AttractionsController {
  constructor(private readonly service: AttractionsService) {}
  @Get()
  @Permissions('resource:attraction:list')
  @ApiOperation({ summary: 'List attractions' })
  list(@Query() query: AttractionQueryDto) {
    return this.service.list(query);
  }
  @Get(':attractionId/prices')
  @Permissions('resource:attraction:list')
  @ApiOperation({ summary: 'List attraction prices' })
  @ApiOkResponse({ type: [AttractionPriceResponse] })
  listPrices(
    @Param('attractionId', new ParseUUIDPipe())
    attractionId: string,
  ) {
    return this.service.listPrices(attractionId);
  }
  @Post(':attractionId/prices')
  @Permissions('resource:attraction:create')
  @ApiOperation({ summary: 'Create an attraction price' })
  @ApiCreatedResponse({ type: AttractionPriceResponse })
  createPrice(
    @Param('attractionId', new ParseUUIDPipe())
    attractionId: string,
    @Body() input: CreateAttractionPriceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createPrice(attractionId, input, user.id);
  }
  @Put(':attractionId/prices/:priceId')
  @Permissions('resource:attraction:update')
  @ApiOperation({ summary: 'Update an attraction price' })
  @ApiOkResponse({ type: AttractionPriceResponse })
  updatePrice(
    @Param('attractionId', new ParseUUIDPipe())
    attractionId: string,
    @Param('priceId', new ParseUUIDPipe()) priceId: string,
    @Body() input: UpdateAttractionPriceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updatePrice(attractionId, priceId, input, user.id);
  }
  @Delete(':attractionId/prices')
  @Permissions('resource:attraction:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete attraction prices' })
  @ApiNoContentResponse()
  deletePrices(
    @Param('attractionId', new ParseUUIDPipe())
    attractionId: string,
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.deletePrices(attractionId, query.ids, user.id);
  }
  @Get(':id')
  @Permissions('resource:attraction:list')
  @ApiOperation({ summary: 'Get an attraction' })
  @ApiOkResponse({ type: AttractionDetailResponse })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }
  @Post()
  @Permissions('resource:attraction:create')
  @ApiOperation({ summary: 'Create an attraction' })
  @ApiCreatedResponse({ type: AttractionDetailResponse })
  create(
    @Body() input: CreateAttractionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }
  @Put(':id')
  @Permissions('resource:attraction:update')
  @ApiOperation({ summary: 'Update an attraction' })
  @ApiOkResponse({ type: AttractionDetailResponse })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateAttractionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }
  @Delete()
  @Permissions('resource:attraction:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete attractions' })
  @ApiNoContentResponse()
  delete(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.delete(query.ids, user.id);
  }
}
