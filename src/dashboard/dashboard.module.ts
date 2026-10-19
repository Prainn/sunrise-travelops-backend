import { Module } from '@nestjs/common';
import { InquiriesModule } from '../inquiries/inquiries.module';
import { ToursModule } from '../tours/tours.module';
import { WebsiteModule } from '../website/website.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [InquiriesModule, WebsiteModule, ToursModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
