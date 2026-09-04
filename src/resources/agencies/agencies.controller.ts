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
@Controller('resources/agencies')
export class AgenciesController {
  constructor(private readonly service: AgenciesService) {}
  @Get()
  @Permissions('resource:agency:list')
  @ApiOperation({ summary: 'List travel agencies' })
  @ApiPaginatedResponse(AgencyListItemResponse, 'Paginated travel agency list')
  list(@Query() query: AgencyQueryDto) {
    return this.service.list(query);
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
  @ApiOperation({ summary: 'Get a travel agency' })
  @ApiSuccessResponse({ type: AgencyDetailResponse })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }
  @Post()
  @Permissions('resource:agency:create')
  @ApiOperation({ summary: 'Create a travel agency' })
  @ApiSuccessResponse({
    status: HttpStatus.CREATED,
    type: AgencyDetailResponse,
  })
  create(
    @Body() input: CreateAgencyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }
  @Put(':id')
  @Permissions('resource:agency:update')
  @ApiOperation({ summary: 'Update a travel agency' })
  @ApiSuccessResponse({ type: AgencyDetailResponse })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateAgencyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }
  @Delete()
  @Permissions('resource:agency:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete travel agencies' })
  @ApiNoContentResponse()
  delete(
    @Query() query: BatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.delete(query.ids, user.id);
  }
}
