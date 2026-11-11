import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { hasSunriseHandlerAccess } from '../sunrise-menu-access';
import { Reflector } from '@nestjs/core';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/constants/error-code';
import { AuthenticatedUser } from '../auth.types';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) {
      return true;
    }

    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;
    if (
      !user ||
      !required.every((permission) => user.permissions.includes(permission)) ||
      !hasSunriseHandlerAccess(
        user,
        context.getClass().name,
        context.getHandler().name,
      )
    ) {
      throw new BusinessException({
        code: ErrorCode.AUTH_FORBIDDEN,
        message: '',
        status: HttpStatus.FORBIDDEN,
      });
    }
    return true;
  }
}
