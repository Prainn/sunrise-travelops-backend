import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResourcesModule } from '../resources/resources.module';
import {
  InquiryEntity,
  InquiryLogEntity,
  ItineraryEntity,
  ItineraryQuoteEntity,
} from './inquiry.entity';
import {
  InquiriesController,
  InquiryLogsController,
  ItinerariesController,
} from './inquiries.controller';
import { InquiriesService } from './inquiries.service';
import { ItineraryValidation } from './itinerary-validation';
import { FeishuModule } from '../feishu/feishu.module';
import { InquiryRemindersService } from './inquiry-reminders.service';
@Module({
  imports: [
    OperationLogsModule,
    ResourcesModule,
    FeishuModule,
    TypeOrmModule.forFeature([
      InquiryEntity,
      InquiryLogEntity,
      ItineraryEntity,
      ItineraryQuoteEntity,
    ]),
  ],
  controllers: [
    InquiriesController,
    ItinerariesController,
    InquiryLogsController,
  ],
  providers: [InquiriesService, ItineraryValidation, InquiryRemindersService],
  exports: [InquiriesService],
})
export class InquiriesModule {}
