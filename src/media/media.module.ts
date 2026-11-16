import { Module } from '@nestjs/common';
import { MediaConfig } from './media.config';
import { MediaStorage } from './media.storage';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { WhatsappDocuments } from './media.whatsapp-documents';
@Module({
  controllers: [MediaController],
  providers: [MediaConfig, MediaStorage, MediaService, WhatsappDocuments],
  exports: [MediaService, WhatsappDocuments],
})
export class MediaModule {}
