import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { BusinessException } from '../common/exceptions/business.exception';

@Injectable()
export class InspectionAlertGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const configured = this.config.get<string>('INSPECTION_ALERT_TOKEN');
    const recipient = this.config.get<string>(
      'INSPECTION_ALERT_RECIPIENT_USER_ID',
    );
    const header = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string } }>()
      .headers.authorization;
    if (
      this.config.get<string>('INSPECTION_ALERT_ENABLED') !== 'true' ||
      !configured ||
      configured.length < 32 ||
      !recipient ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        recipient,
      )
    ) {
      throw new BusinessException({
        code: 'INSPECTION_ALERT_UNAVAILABLE',
        message: '巡检通知未配置',
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }
    const supplied = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const digest = (value: string) =>
      createHash('sha256').update(value).digest();
    if (!supplied || !timingSafeEqual(digest(supplied), digest(configured))) {
      throw new BusinessException({
        code: 'AUTH_TOKEN_INVALID',
        message: '访问令牌无效',
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    return true;
  }
}
