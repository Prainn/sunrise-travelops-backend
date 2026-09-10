import { CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';
import { Request } from 'express';

const LYNX_ORIGINS = ['https://lynxtour.cn', 'https://www.lynxtour.cn'];

export function createCorsOptions(
  businessOrigins: string[],
): CorsOptionsDelegate<Request> {
  return (request, callback) => {
    const path = request.path.replace(/\/$/, '').toLowerCase();
    const isLynxRequest =
      (path === '/api/lynx' || path === '/api/health') &&
      LYNX_ORIGINS.includes(request.get('origin') ?? '');

    callback(
      null,
      isLynxRequest
        ? {
            origin: LYNX_ORIGINS,
            credentials: false,
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type'],
          }
        : { origin: businessOrigins, credentials: true },
    );
  };
}
