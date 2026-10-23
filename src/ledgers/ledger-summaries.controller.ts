import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ApiCommonErrorResponses } from '../common/swagger/api-response.decorator';
import {
  SummaryQueryDto,
  SummaryReportParamsDto,
} from './ledger-summaries.dto';
import { LedgerSummariesService } from './ledger-summaries.service';

@ApiTags('Ledger Summaries')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('ledgers/summaries')
export class LedgerSummariesController {
  constructor(private readonly service: LedgerSummariesService) {}

  @Get(':report')
  @Permissions('ledger:summary:list')
  list(
    @Param() params: SummaryReportParamsDto,
    @Query() query: SummaryQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.list(params.report, query, actor);
  }
}
