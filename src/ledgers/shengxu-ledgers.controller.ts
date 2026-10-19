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
  LedgerQueryDto,
  ShengxuLedgerInputDto,
  UpdateShengxuLedgerDto,
  LedgerDeleteQueryDto,
  AgencyOptionsQueryDto,
} from './ledger.dto';
import { ShengxuLedgersService } from './shengxu-ledgers.service';
@ApiTags('Shengxu Ledgers')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('ledgers/shengxu')
export class ShengxuLedgersController {
  constructor(private readonly service: ShengxuLedgersService) {}
  @Get()
  @Permissions('ledger:shengxu:list')
  list(
    @Query() query: LedgerQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.list(query, actor);
  }

  @Get('agencies')
  @Permissions('ledger:shengxu:list', 'resource:agency:list')
  agencies(
    @Query() query: AgencyOptionsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.agencies(query, actor);
  }
  @Get('agencies/:agencyId/contacts')
  @Permissions('ledger:shengxu:list', 'resource:agency:list')
  contacts(
    @Param('agencyId', new ParseUUIDPipe()) id: string,
    @Query() query: AgencyOptionsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.contacts(id, query, actor);
  }

  @Get(':id')
  @Permissions('ledger:shengxu:list')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.get(id, actor);
  }
  @Post()
  @Permissions('ledger:shengxu:create')
  create(
    @Body() input: ShengxuLedgerInputDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.create(input, actor);
  }
  @Put(':id')
  @Permissions('ledger:shengxu:update')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateShengxuLedgerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.update(id, input, actor);
  }
  @Delete(':id')
  @HttpCode(204)
  @Permissions('ledger:shengxu:delete')
  async delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: LedgerDeleteQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.service.delete(id, query.version, actor);
  }
}
