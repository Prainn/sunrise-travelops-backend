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
  CreateSupplierDto,
  SupplierOptionResponse,
  SupplierQueryDto,
  SupplierResponse,
  UpdateSupplierDto,
} from './dto/supplier.dto';
import { SuppliersService } from './suppliers.service';
@ApiTags('Resources')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('resources/suppliers')
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}
  @Get()
  @Permissions('resource:supplier:list')
  @ApiOperation({ summary: 'List ground operators' })
  @ApiPaginatedResponse(SupplierResponse)
  list(@Query() query: SupplierQueryDto) {
    return this.service.list(query);
  }
  @Get('options')
  @Permissions('resource:supplier:list')
  @ApiOperation({ summary: 'List enabled ground operator options' })
  @ApiSuccessResponse({ type: SupplierOptionResponse, isArray: true })
  options() {
    return this.service.options();
  }
  @Get(':id')
  @Permissions('resource:supplier:list')
  @ApiOperation({ summary: 'Get a ground operator' })
  @ApiSuccessResponse({ type: SupplierResponse })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }
  @Post()
  @Permissions('resource:supplier:create')
  @ApiOperation({ summary: 'Create a ground operator' })
  @ApiSuccessResponse({ status: HttpStatus.CREATED, type: SupplierResponse })
  create(
    @Body() input: CreateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }
  @Put(':id')
  @Permissions('resource:supplier:update')
  @ApiOperation({ summary: 'Update a ground operator' })
  @ApiSuccessResponse({ type: SupplierResponse })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }
  @Delete()
  @Permissions('resource:supplier:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete ground operators' })
  @ApiNoContentResponse()
  delete(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.delete(query.ids, user.id);
  }
}
