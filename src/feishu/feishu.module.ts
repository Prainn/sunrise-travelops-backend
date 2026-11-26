import { NotificationSettingsModule } from '../notifications/notification-settings.module';
import { NotificationDigestsService } from '../notifications/notification-digests.service';
import { Module } from '@nestjs/common';
import { FeishuService } from './feishu.service';

@Module({
  imports: [NotificationSettingsModule],
  providers: [FeishuService, NotificationDigestsService],
  exports: [FeishuService],
})
export class FeishuModule {}
