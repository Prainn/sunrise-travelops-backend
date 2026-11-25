import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { Module } from '@nestjs/common';
import { MediaConfig } from './media.config';
import { MediaStorage } from './media.storage';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { WhatsappDocuments } from './media.whatsapp-documents';
import { WhatsappDocumentArchive } from './media.document-archive';
@Module({
  imports: [OperationLogsModule],
  controllers: [MediaController],
  providers: [
    MediaConfig,
    MediaStorage,
    MediaService,
    WhatsappDocuments,
    WhatsappDocumentArchive,
  ],
  exports: [MediaService, WhatsappDocuments, WhatsappDocumentArchive],
})
export class MediaModule {}
