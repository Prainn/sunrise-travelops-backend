import { LedgerSummariesController } from './ledger-summaries.controller';
import { LedgerSummariesService } from './ledger-summaries.service';
import { Module } from '@nestjs/common';
import { ShengxuLedgersController } from './shengxu-ledgers.controller';
import { ShengxuLedgersService } from './shengxu-ledgers.service';
import { DirectLedgersController } from './direct-ledgers.controller';
import { DirectLedgersService } from './direct-ledgers.service';
@Module({
  controllers: [
    LedgerSummariesController,
    ShengxuLedgersController,
    DirectLedgersController,
  ],
  providers: [
    LedgerSummariesService,
    ShengxuLedgersService,
    DirectLedgersService,
  ],
})
export class LedgersModule {}
