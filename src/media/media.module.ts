import { Module } from '@nestjs/common';
import { MediaConfig } from './media.config';
import { MediaStorage } from './media.storage';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
@Module({
  controllers: [MediaController],
  providers: [MediaConfig, MediaStorage, MediaService],
  exports: [MediaService],
})
export class MediaModule {}
