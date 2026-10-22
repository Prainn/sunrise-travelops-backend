import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  ApiCommonErrorResponses,
  ApiPaginatedResponse,
  ApiSuccessResponse,
} from '../common/swagger/api-response.decorator';
import { AccountLinksService } from './account-links.service';
import {
  AccountLinkCandidateQueryDto,
  AccountLinkQueryDto,
  AccountLinkResponse,
  CreateAccountLinkDto,
  DeleteAccountLinkDto,
  LinkedAccountResponse,
  UpdateAccountLinkDto,
} from './dto/account-link.dto';

@ApiTags('Account links')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('system/account-links')
export class AccountLinksController {
  constructor(private readonly links: AccountLinksService) {}
  @Get()
  @Permissions('sys:account-link:manage')
  @ApiOperation({ summary: 'List linked account groups' })
  @ApiPaginatedResponse(AccountLinkResponse)
  list(
    @Query() query: AccountLinkQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.links.list(query, actor);
  }
  @Get('candidates')
  @Permissions('sys:account-link:manage')
  @ApiOperation({ summary: 'List unlinked or current-group business accounts' })
  @ApiPaginatedResponse(LinkedAccountResponse)
  candidates(
    @Query() query: AccountLinkCandidateQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.links.candidates(query, actor);
  }
  @Get(':id')
  @Permissions('sys:account-link:manage')
  @ApiSuccessResponse({ type: AccountLinkResponse })
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.links.get(id, actor);
  }
  @Post()
  @Permissions('sys:account-link:manage')
  @ApiSuccessResponse({ status: 201, type: AccountLinkResponse })
  create(
    @Body() input: CreateAccountLinkDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.links.save(input, actor, req.ip ?? '');
  }
  @Put(':id')
  @Permissions('sys:account-link:manage')
  @ApiSuccessResponse({ type: AccountLinkResponse })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateAccountLinkDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.links.save(input, actor, req.ip ?? '', id);
  }
  @Delete(':id')
  @HttpCode(204)
  @Permissions('sys:account-link:manage')
  @ApiNoContentResponse()
  async delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: DeleteAccountLinkDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    await this.links.save(input, actor, req.ip ?? '', id, true);
  }
}
