import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { WebsiteModule } from '../website/website.module';
import { AliMailProvider } from './alimail.provider';
import { MailController } from './mail.controller';
import { MailReplies } from './mail.replies';
import { MailService } from './mail.service';
import { MailSync } from './mail.sync';
@Module({
  imports: [WebsiteModule, MediaModule],
  controllers: [MailController],
  providers: [AliMailProvider, MailReplies, MailService, MailSync],
})
export class MailModule {}
