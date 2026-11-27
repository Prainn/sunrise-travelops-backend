import { Module } from '@nestjs/common';
import { FeishuModule } from '../feishu/feishu.module';
import { MediaModule } from '../media/media.module';
import { WebsiteModule } from '../website/website.module';
import { AliMailProvider } from './alimail.provider';
import { MailController } from './mail.controller';
import { MailNotificationsService } from './mail-notifications.service';
import { MailRuntime } from './mail-runtime.service';
import { MailReplies } from './mail.replies';
import { MailService } from './mail.service';
import { MailSync } from './mail.sync';
@Module({
  imports: [WebsiteModule, MediaModule, FeishuModule],
  controllers: [MailController],
  providers: [
    AliMailProvider,
    MailRuntime,
    MailReplies,
    MailService,
    MailSync,
    MailNotificationsService,
  ],
})
export class MailModule {}
