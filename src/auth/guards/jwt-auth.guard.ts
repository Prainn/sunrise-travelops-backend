import { ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { ErrorCode } from '../../common/constants/error-code';
import { BusinessException } from '../../common/exceptions/business.exception';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic ? true : super.canActivate(context);
  }

  handleRequest<TUser>(
    error: unknown,
    user: TUser | false | null,
    info: unknown,
  ): TUser {
    if (error instanceof Error) throw error;
    if (error) throw new Error('Authentication failed', { cause: error });
    if (user) return user;

    const infoName =
      typeof info === 'object' && info !== null && 'name' in info
        ? info.name
        : undefined;
    const expired = infoName === 'TokenExpiredError';
    throw new BusinessException({
      code: expired
        ? ErrorCode.AUTH_TOKEN_EXPIRED
        : ErrorCode.AUTH_TOKEN_INVALID,
      message: expired ? '访问令牌已过期' : '访问令牌无效',
      status: HttpStatus.UNAUTHORIZED,
    });
  }
}
