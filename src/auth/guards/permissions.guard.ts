import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApplicationError } from '../../common/errors/application-error';
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
      !required.every((permission) => user.permissions.includes(permission))
    ) {
      throw new ApplicationError(
        'PERMISSION_DENIED',
        'You do not have permission to perform this action',
        403,
      );
    }
    return true;
  }
}
