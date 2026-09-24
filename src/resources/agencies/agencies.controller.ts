import { UseInterceptors } from '@nestjs/common';
import { ResourceScopeInterceptor } from '../common/resource-scope';
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
import { AgenciesService } from './agencies.service';
import { BusinessUnit } from '../../users/user-identity.entity';
import {
  AgencyContactResponse,
  AgencyDetailResponse,
  AgencyListItemResponse,
  AgencyQueryDto,
  CreateAgencyContactDto,
  CreateAgencyDto,
  UpdateAgencyContactDto,
  UpdateAgencyDto,
} from './dto/agency.dto';

@ApiTags('Resources')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@UseInterceptors(ResourceScopeInterceptor)
@Controller('resources/agencies')
export class AgenciesController {
  constructor(private readonly service: AgenciesService) {}
  @Get()
  @Permissions('resource:agency:list')
  @ApiOperation({ summary: 'List organizing agencies' })
  @ApiPaginatedResponse(
    AgencyListItemResponse,
    'Paginated organizing agency list',
  )
  list(@Query() query: AgencyQueryDto) {
    return this.service.list(query);
  }
  @Get('coordinators')
  @Permissions('resource:agency:list')
  @ApiOperation({ summary: 'List coordinators for an organizing agency' })
  coordinators(
    @Query('businessUnit') businessUnit: BusinessUnit,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.coordinators(businessUnit, user);
  }
  @Get(':agencyId/contacts')
  @Permissions('resource:agency:list')
  @ApiOperation({ summary: 'List agency contacts' })
  @ApiSuccessResponse({ type: AgencyContactResponse, isArray: true })
  listContacts(@Param('agencyId', new ParseUUIDPipe()) agencyId: string) {
    return this.service.listContacts(agencyId);
  }
  @Post(':agencyId/contacts')
  @Permissions('resource:agency:create')
  @ApiOperation({ summary: 'Create an agency contact' })
  @ApiSuccessResponse({
    status: HttpStatus.CREATED,
    type: AgencyContactResponse,
  })
  createContact(
    @Param('agencyId', new ParseUUIDPipe()) agencyId: string,
    @Body() input: CreateAgencyContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createContact(agencyId, input, user.id);
  }
  @Put(':agencyId/contacts/:contactId')
  @Permissions('resource:agency:update')
  @ApiOperation({ summary: 'Update an agency contact' })
  @ApiSuccessResponse({ type: AgencyContactResponse })
  updateContact(
    @Param('agencyId', new ParseUUIDPipe()) agencyId: string,
    @Param('contactId', new ParseUUIDPipe())
    contactId: string,
    @Body() input: UpdateAgencyContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateContact(agencyId, contactId, input, user.id);
  }
  @Delete(':agencyId/contacts')
  @Permissions('resource:agency:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete agency contacts' })
  @ApiNoContentResponse()
  deleteContacts(
    @Param('agencyId', new ParseUUIDPipe()) agencyId: string,
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.deleteContacts(agencyId, query.ids, user.id);
  }
  @Get(':id')
  @Permissions('resource:agency:list')
  @ApiOperation({ summary: 'Get an organizing agency' })
  @ApiSuccessResponse({ type: AgencyDetailResponse })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }
  @Post()
  @Permissions('resource:agency:create')
  @ApiOperation({ summary: 'Create an organizing agency' })
  @ApiSuccessResponse({
    status: HttpStatus.CREATED,
    type: AgencyDetailResponse,
  })
  create(
    @Body() input: CreateAgencyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user);
  }
  @Put(':id')
  @Permissions('resource:agency:update')
  @ApiOperation({ summary: 'Update an organizing agency' })
  @ApiSuccessResponse({ type: AgencyDetailResponse })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateAgencyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user);
  }
  @Delete()
  @Permissions('resource:agency:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete organizing agencies' })
  @ApiNoContentResponse()
  delete(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.delete(query.ids, user.id);
  }
}
