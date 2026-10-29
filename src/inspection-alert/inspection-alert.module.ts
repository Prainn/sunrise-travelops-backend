import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeishuModule } from '../feishu/feishu.module';
import { UserEntity } from '../users/user.entity';
import { InspectionAlertController } from './inspection-alert.controller';
import { InspectionAlertGuard } from './inspection-alert.guard';
import { InspectionAlertService } from './inspection-alert.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity]), FeishuModule],
  controllers: [InspectionAlertController],
  providers: [InspectionAlertGuard, InspectionAlertService],
})
export class InspectionAlertModule {}
