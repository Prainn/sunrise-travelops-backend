import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  MethodNotAllowedException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import {
  normalizeVisitIp,
  visitsApiIps,
  visitsApiToken,
} from './website-visits-api.config';

@Injectable()
export class WebsiteVisitsApiGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    if (
      this.config.get('LYNX_VISITS_API_ENABLED') !== 'true' ||
      (this.config.get('LYNX_VISITS_SOURCE_MODE') ?? 'database') !== 'database'
    )
      throw new ServiceUnavailableException('Visit source API is disabled');
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method !== 'GET') throw new MethodNotAllowedException();
    let allowed: string[];
    try {
      allowed = visitsApiIps(this.config.get('LYNX_VISITS_API_ALLOWED_IPS'));
    } catch {
      throw new ServiceUnavailableException();
    }
    if (!allowed.includes(normalizeVisitIp(request.ip ?? '')))
      throw new ForbiddenException();
    const token = this.config.get<string>('LYNX_VISITS_API_SERVER_TOKEN');
    if (!visitsApiToken(token)) throw new ServiceUnavailableException();
    const expected = Buffer.from(`Bearer ${token}`);
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new UnauthorizedException();
    return true;
  }
}
