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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ApiCommonErrorResponses } from '../common/swagger/api-response.decorator';
import {
  DirectLedgerQueryDto,
  CreateDirectLedgerDto,
  UpdateDirectLedgerDto,
  LedgerDeleteQueryDto,
  LedgerVersionDto,
  LedgerOperationDto,
} from './ledger.dto';
import { DirectLedgersService } from './direct-ledgers.service';
@ApiTags('Direct Ledgers')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('ledgers/direct')
export class DirectLedgersController {
  constructor(private readonly service: DirectLedgersService) {}
  @Get()
  @Permissions('ledger:direct:list')
  list(
    @Query() query: DirectLedgerQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.list(query, actor);
  }

  @Get('operators')
  @Permissions('ledger:direct:list')
  operators(
    @Query() query: DirectLedgerQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.operators(query, actor);
  }
  @Post(':id/review')
  @HttpCode(200)
  @Permissions('ledger:direct:review')
  review(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: LedgerVersionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.review(id, input.version, actor);
  }
  @Put(':id/operation')
  @Permissions('ledger:direct:operate')
  operate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: LedgerOperationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.operate(id, input, actor);
  }

  @Get(':id')
  @Permissions('ledger:direct:list')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.get(id, actor);
  }
  @Post()
  @Permissions('ledger:direct:create')
  create(
    @Body() input: CreateDirectLedgerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.create(input, actor);
  }
  @Put(':id')
  @Permissions('ledger:direct:update')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateDirectLedgerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.update(id, input, actor);
  }
  @Delete(':id')
  @HttpCode(204)
  @Permissions('ledger:direct:delete')
  async delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: LedgerDeleteQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.service.delete(id, query.version, actor);
  }
}
