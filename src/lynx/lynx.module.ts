import { WebsiteModule } from '../website/website.module';
import { WebsiteVisitsController } from './website-visits.controller';
import { WebsiteVisitsService } from './website-visits.service';
import { WebsiteVisitsReader } from './website-visits-reader';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LynxVisit } from './lynx-visit.entity';
import { LynxController } from './lynx.controller';
import { WhatsappRegistryService } from './whatsapp-registry.service';

@Module({
  imports: [TypeOrmModule.forFeature([LynxVisit]), WebsiteModule],
  controllers: [LynxController, WebsiteVisitsController],
  providers: [
    WhatsappRegistryService,
    WebsiteVisitsService,
    WebsiteVisitsReader,
  ],
})
export class LynxModule {}
