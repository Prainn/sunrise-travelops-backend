import { WebsiteModule } from '../website/website.module';
import { WebsiteVisitsController } from './website-visits.controller';
import { WebsiteVisitsService } from './website-visits.service';
import { WebsiteVisitsReader } from './website-visits-reader';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LynxVisit } from './lynx-visit.entity';
import { LynxController } from './lynx.controller';
import { WhatsappRegistryService } from './whatsapp-registry.service';
import { WebsiteVisitsDatabaseSource } from './website-visits-database.source';
import { WebsiteVisitsHttpSource } from './website-visits-http.source';
import { WebsiteVisitsSource } from './website-visits.source';
import { WebsiteVisitsApiController } from './website-visits-api.controller';
import { WebsiteVisitsApiGuard } from './website-visits-api.guard';

@Module({
  imports: [TypeOrmModule.forFeature([LynxVisit]), WebsiteModule],
  controllers: [
    LynxController,
    WebsiteVisitsController,
    WebsiteVisitsApiController,
  ],
  providers: [
    WhatsappRegistryService,
    WebsiteVisitsService,
    WebsiteVisitsReader,
    WebsiteVisitsDatabaseSource,
    WebsiteVisitsHttpSource,
    WebsiteVisitsSource,
    WebsiteVisitsApiGuard,
  ],
})
export class LynxModule {}
