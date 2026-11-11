import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsInt, Min } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  ApiCommonErrorResponses,
  ApiSuccessResponse,
} from '../common/swagger/api-response.decorator';
import { NotificationSettingsService } from './notification-settings.service';
import { NOTIFICATION_TYPES } from './notification-settings';

export class UpdateNotificationSettingDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version: number;
}
export class NotificationSettingResponse {
  @ApiProperty({ enum: Object.keys(NOTIFICATION_TYPES) }) type: string;
  @ApiProperty() name: string;
  @ApiProperty() enabled: boolean;
  @ApiProperty() version: number;
  @ApiProperty() updatedAt: string;
}
@ApiTags('Notification management')
@ApiBearerAuth()
@ApiCommonErrorResponses()
@Controller('system/notifications')
export class NotificationSettingsController {
  constructor(private readonly service: NotificationSettingsService) {}
  @Get()
  @Permissions('sys:notification:list')
  @ApiOperation({ summary: '读取飞书业务通知开关（总部系统管理员）' })
  @ApiSuccessResponse({ type: NotificationSettingResponse, isArray: true })
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.list(actor);
  }

  @Put(':type')
  @Permissions('sys:notification:update')
  @ApiOperation({ summary: '按版本保存单类飞书通知开关（总部系统管理员）' })
  @ApiSuccessResponse({ type: NotificationSettingResponse })
  update(
    @Param('type') type: string,
    @Body() input: UpdateNotificationSettingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.update(type, input, actor);
  }
}
