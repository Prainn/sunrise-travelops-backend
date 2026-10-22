import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ApiCommonErrorResponses } from '../common/swagger/api-response.decorator';
import { BusinessGroupsService } from './business-groups.service';
import {
  BusinessGroupQueryDto,
  CreateBusinessGroupDto,
  UpdateBusinessGroupDto,
} from './dto/business-group.dto';

@ApiTags('Business Groups')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('system/business-groups')
export class BusinessGroupsController {
  constructor(private readonly service: BusinessGroupsService) {}
  @Get()
  @Permissions('sys:business-group:list')
  list(
    @Query() query: BusinessGroupQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.list(query, actor);
  }
  @Get(':id')
  @Permissions('sys:business-group:list')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.get(id, actor);
  }
  @Post()
  @Permissions('sys:business-group:create')
  create(
    @Body() input: CreateBusinessGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.create(input, actor);
  }
  @Put(':id')
  @Permissions('sys:business-group:update')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateBusinessGroupDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.update(id, input, actor);
  }
}
