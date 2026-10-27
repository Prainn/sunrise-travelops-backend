import { LedgerSummariesController } from './ledger-summaries.controller';
import { LedgerSummariesService } from './ledger-summaries.service';
import { FeishuModule } from '../feishu/feishu.module';
import { LedgerNotificationsService } from './ledger-notifications.service';
import { Module } from '@nestjs/common';
import { ShengxuLedgersController } from './shengxu-ledgers.controller';
import { ShengxuLedgersService } from './shengxu-ledgers.service';
import { DirectLedgersController } from './direct-ledgers.controller';
import { DirectLedgersService } from './direct-ledgers.service';
@Module({
  imports: [FeishuModule],
  controllers: [
    LedgerSummariesController,
    ShengxuLedgersController,
    DirectLedgersController,
  ],
  providers: [
    LedgerNotificationsService,
    LedgerSummariesService,
    ShengxuLedgersService,
    DirectLedgersService,
  ],
})
export class LedgersModule {}
