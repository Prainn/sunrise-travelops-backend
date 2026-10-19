import { Module } from '@nestjs/common';
import { ShengxuLedgersController } from './shengxu-ledgers.controller';
import { ShengxuLedgersService } from './shengxu-ledgers.service';
import { DirectLedgersController } from './direct-ledgers.controller';
import { DirectLedgersService } from './direct-ledgers.service';
@Module({
  controllers: [ShengxuLedgersController, DirectLedgersController],
  providers: [ShengxuLedgersService, DirectLedgersService],
})
export class LedgersModule {}
