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
  CreateHotelDto,
  HotelQueryDto,
  HotelResponse,
  UpdateHotelDto,
} from './dto/hotel.dto';
import { HotelsService } from './hotels.service';
@ApiTags('Resources')
@ApiBearerAuth()
@Controller('resources/hotels')
export class HotelsController {
  constructor(private readonly service: HotelsService) {}
  @Get()
  @Permissions('resource:hotel:list')
  @ApiOperation({ summary: 'List hotels' })
  list(@Query() query: HotelQueryDto) {
    return this.service.list(query);
  }
  @Get(':id')
  @Permissions('resource:hotel:list')
  @ApiOperation({ summary: 'Get a hotel' })
  @ApiOkResponse({ type: HotelResponse })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }
  @Post()
  @Permissions('resource:hotel:create')
  @ApiOperation({ summary: 'Create a hotel' })
  @ApiCreatedResponse({ type: HotelResponse })
  create(
    @Body() input: CreateHotelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }
  @Put(':id')
  @Permissions('resource:hotel:update')
  @ApiOperation({ summary: 'Update a hotel' })
  @ApiOkResponse({ type: HotelResponse })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateHotelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }
  @Delete()
  @Permissions('resource:hotel:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete hotels' })
  @ApiNoContentResponse()
  delete(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.delete(query.ids, user.id);
  }
}
