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
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  NumberOptionResponse,
  StringOptionResponse,
} from '../common/dto/option-response.dto';
import {
  ApiCommonErrorResponses,
  ApiPaginatedResponse,
  ApiSuccessResponse,
} from '../common/swagger/api-response.decorator';
import {
  CreateUserDto,
  CreatedUserResponse,
  ResetUserPasswordDto,
  UserBatchIdsQueryDto,
  UserQueryDto,
  UpdateUserDto,
  UserItemResponse,
} from './dto/user-management.dto';
import { UserManagementService } from './user-management.service';

@ApiTags('Users')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('users')
export class UserManagementController {
  constructor(private readonly userManagement: UserManagementService) {}

  @Get()
  @Permissions('sys:user:list')
  @ApiOperation({ summary: 'List users' })
  @ApiPaginatedResponse(UserItemResponse, 'Paginated user list')
  getPage(@Query() query: UserQueryDto) {
    return this.userManagement.getPage(query);
  }

  @Get('options/roles')
  @Permissions('sys:user:list')
  @ApiOperation({ summary: 'List assignable role options' })
  @ApiSuccessResponse({ type: StringOptionResponse, isArray: true })
  getRoleOptions() {
    return this.userManagement.getRoleOptions();
  }

  @Get('options/departments')
  @Permissions('sys:user:list')
  @ApiOperation({ summary: 'List department options' })
  @ApiSuccessResponse({ type: NumberOptionResponse, isArray: true })
  getDepartmentOptions() {
    return this.userManagement.getDepartmentOptions();
  }

  @Get(':id')
  @Permissions('sys:user:list')
  @ApiOperation({ summary: 'Get user form data' })
  @ApiSuccessResponse({ type: UserItemResponse, description: 'User form data' })
  getFormData(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.userManagement.getFormData(id);
  }

  @Post()
  @Permissions('sys:user:create')
  @ApiOperation({ summary: 'Create a user' })
  @ApiSuccessResponse({
    status: HttpStatus.CREATED,
    type: CreatedUserResponse,
    description: 'Created user; includes a one-time password if omitted',
  })
  create(@Body() input: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.userManagement.create(input, user.id);
  }

  @Put(':id')
  @Permissions('sys:user:update')
  @ApiOperation({ summary: 'Update a user' })
  @ApiSuccessResponse({ type: UserItemResponse, description: 'Updated user' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userManagement.update(id, input, user.id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions('sys:user:delete')
  @ApiOperation({ summary: 'Soft-delete users' })
  @ApiNoContentResponse()
  delete(
    @Query() query: UserBatchIdsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userManagement.delete(query.ids, user.id);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions('sys:user:reset-password')
  @ApiOperation({ summary: 'Reset a user password and revoke refresh tokens' })
  @ApiNoContentResponse()
  resetPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ResetUserPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userManagement.resetPassword(id, input.password, user.id);
  }
}
