import { Module } from '@nestjs/common';
import { WebsiteModule } from '../website/website.module';
import { WhatsappConfig } from './whatsapp.config';
import { WhatsappProvider } from './whatsapp.provider';
import { WhatsappEvents } from './whatsapp.events';
import { WhatsappService } from './whatsapp.service';
import { WhatsappWorker } from './whatsapp.worker';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappIngressController } from './whatsapp-ingress.controller';
@Module({
  imports: [WebsiteModule],
  controllers: [WhatsappController, WhatsappIngressController],
  providers: [
    WhatsappConfig,
    WhatsappProvider,
    WhatsappEvents,
    WhatsappService,
    WhatsappWorker,
  ],
  exports: [WhatsappEvents, WhatsappService],
})
export class WhatsappModule {}
