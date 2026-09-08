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
@Module({
  imports: [
    ResourcesModule,
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
  providers: [InquiriesService, ItineraryValidation],
})
export class InquiriesModule {}
