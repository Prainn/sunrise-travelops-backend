import { Module } from '@nestjs/common';
import { NotificationSettingsController } from './notification-settings.controller';
import { NotificationSettingsService } from './notification-settings.service';
@Module({
  controllers: [NotificationSettingsController],
  providers: [NotificationSettingsService],
})
export class NotificationSettingsModule {}
