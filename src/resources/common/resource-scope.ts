import { AsyncLocalStorage } from 'node:async_hooks';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthenticatedUser } from '../../auth/auth.types';
import { ResourceLibrary } from '../../users/user-identity.entity';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
const context = new AsyncLocalStorage<{
  user: AuthenticatedUser;
  library: ResourceLibrary | null;
}>();
function forbidden(): never {
  throw new BusinessException({
    code: 'AUTH_FORBIDDEN',
    message: '无权访问该资源库',
    status: HttpStatus.FORBIDDEN,
  });
}
export function resolveBusinessLibrary(
  user: AuthenticatedUser,
  library: unknown,
  businessUnit: unknown,
): unknown {
  if (businessUnit === undefined) return library;
  if (
    typeof businessUnit !== 'string' ||
    !['shengxu', 'linxi', 'website'].includes(businessUnit)
  )
    throw new BusinessException({
      code: 'VALIDATION_ERROR',
      message: '无效的业务部',
      status: HttpStatus.BAD_REQUEST,
    });
  if (user.scope !== 'headquarters' && user.scope !== businessUnit) forbidden();
  const mapped = businessUnit === 'shengxu' ? 'shengxu' : 'shared';
  if (library != null && library !== mapped) forbidden();
  return mapped;
}

export function withResourceScope<T>(
  user: AuthenticatedUser,
  requested: unknown,
  action: () => T,
): T {
  if (
    requested != null &&
    (typeof requested !== 'string' ||
      !['shengxu', 'shared'].includes(requested))
  )
    forbidden();
  if (user.resourceLibrary && requested && requested !== user.resourceLibrary)
    forbidden();
  return context.run(
    {
      user,
      library:
        user.resourceLibrary ??
        (requested as ResourceLibrary | undefined) ??
        null,
    },
    action,
  );
}
export function resourceLibrary(required = false): ResourceLibrary | null {
  const active = context.getStore();
  if (!active) forbidden();
  if (required && !active.library)
    throw new BusinessException({
      code: 'RESOURCE_CITY_INVALID',
      message: '请选择资源库',
      status: HttpStatus.BAD_REQUEST,
    });
  return active.library;
}
export function scopeResources<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
  alias: string,
) {
  const library = resourceLibrary();
  if (library)
    builder.andWhere(`${alias}.library = :resourceLibrary`, {
      resourceLibrary: library,
    });
  return builder;
}
export function assertResourceLibrary(entity: ObjectLiteral) {
  const library = resourceLibrary();
  if (entity.library && library && entity.library !== library) forbidden();
}
@Injectable()
export class ResourceScopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest<{
      user: AuthenticatedUser;
      query: { library?: string; businessUnit?: string };
      body?: { library?: string };
    }>();
    return new Observable((subscriber) =>
      withResourceScope(
        req.user,
        resolveBusinessLibrary(
          req.user,
          req.body?.library ?? req.query.library,
          req.query.businessUnit,
        ),
        () => next.handle().subscribe(subscriber),
      ),
    );
  }
}
