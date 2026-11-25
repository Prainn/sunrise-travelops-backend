import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLogEntity } from './operation-log.entity';
import {
  ClientEventIdentityGuard,
  OperationLogsController,
} from './operation-logs.controller';
import { OperationLogsService } from './operation-logs.service';

@Module({
  imports: [TypeOrmModule.forFeature([OperationLogEntity])],
  controllers: [OperationLogsController],
  providers: [OperationLogsService, ClientEventIdentityGuard],
  exports: [OperationLogsService],
})
export class OperationLogsModule {}
