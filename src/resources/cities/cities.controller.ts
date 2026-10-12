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
  CreateCityDto,
  CityQueryDto,
  CityResponse,
  UpdateCityDto,
} from './dto/city.dto';
import { CitiesService } from './cities.service';
@ApiTags('Resources')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('resources/cities')
export class CitiesController {
  constructor(private readonly service: CitiesService) {}
  @Get()
  @Permissions('resource:city:list')
  @ApiOperation({ summary: 'List cities' })
  @ApiPaginatedResponse(CityResponse)
  list(@Query() query: CityQueryDto) {
    return this.service.list(query);
  }
  @Get('options')
  @ApiOperation({ summary: 'List enabled city options' })
  @ApiSuccessResponse({ type: CityResponse, isArray: true })
  options() {
    return this.service.options();
  }
  @Get(':id')
  @Permissions('resource:city:list')
  @ApiOperation({ summary: 'Get a city' })
  @ApiSuccessResponse({ type: CityResponse })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }
  @Post()
  @Permissions('resource:city:create')
  @ApiOperation({ summary: 'Create a city' })
  @ApiSuccessResponse({ status: HttpStatus.CREATED, type: CityResponse })
  create(@Body() input: CreateCityDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(input, user.id);
  }
  @Put(':id')
  @Permissions('resource:city:update')
  @ApiOperation({ summary: 'Update a city' })
  @ApiSuccessResponse({ type: CityResponse })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateCityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }
  @Delete()
  @Permissions('resource:city:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete cities' })
  @ApiNoContentResponse()
  delete(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.delete(query.ids, user.id);
  }
}
