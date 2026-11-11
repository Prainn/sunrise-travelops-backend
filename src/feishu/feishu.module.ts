import { NotificationSettingsModule } from '../notifications/notification-settings.module';
import { Module } from '@nestjs/common';
import { FeishuService } from './feishu.service';

@Module({
  imports: [NotificationSettingsModule],
  providers: [FeishuService],
  exports: [FeishuService],
})
export class FeishuModule {}
