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
  CreateTransportDto,
  TransportQueryDto,
  TransportResponse,
  UpdateTransportDto,
} from './dto/transport.dto';
import { TransportsService } from './transports.service';
@ApiTags('Resources')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('resources/transports')
export class TransportsController {
  constructor(private readonly service: TransportsService) {}
  @Get()
  @Permissions('resource:transport:list')
  @ApiOperation({ summary: 'List vehicle and driver resources' })
  @ApiPaginatedResponse(TransportResponse)
  list(@Query() query: TransportQueryDto) {
    return this.service.list(query);
  }
  @Get(':id')
  @Permissions('resource:transport:list')
  @ApiOperation({ summary: 'Get a vehicle and driver resource' })
  @ApiSuccessResponse({ type: TransportResponse })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }
  @Post()
  @Permissions('resource:transport:create')
  @ApiOperation({ summary: 'Create a vehicle and driver resource' })
  @ApiSuccessResponse({ status: HttpStatus.CREATED, type: TransportResponse })
  create(
    @Body() input: CreateTransportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }
  @Put(':id')
  @Permissions('resource:transport:update')
  @ApiOperation({ summary: 'Update a vehicle and driver resource' })
  @ApiSuccessResponse({ type: TransportResponse })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateTransportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }
  @Delete()
  @Permissions('resource:transport:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete vehicle and driver resources' })
  @ApiNoContentResponse()
  delete(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.delete(query.ids, user.id);
  }
}
