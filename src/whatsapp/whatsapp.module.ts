import { Module } from '@nestjs/common';
import { WebsiteModule } from '../website/website.module';
import { WhatsappConfig } from './whatsapp.config';
import { WhatsappProvider } from './whatsapp.provider';
import { WhatsappEvents } from './whatsapp.events';
import { WhatsappService } from './whatsapp.service';
import { WhatsappWorker } from './whatsapp.worker';
import { WhatsappQueueToken } from './whatsapp.queue-token';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappIngressController } from './whatsapp-ingress.controller';
import {
  WhatsappQuickReplies,
  WhatsappQuickRepliesController,
} from './whatsapp-quick-replies.controller';
@Module({
  imports: [WebsiteModule],
  controllers: [
    WhatsappController,
    WhatsappIngressController,
    WhatsappQuickRepliesController,
  ],
  providers: [
    WhatsappConfig,
    WhatsappProvider,
    WhatsappEvents,
    WhatsappService,
    WhatsappWorker,
    WhatsappQueueToken,
    WhatsappQuickReplies,
  ],
  exports: [WhatsappEvents, WhatsappService],
})
export class WhatsappModule {}
