import { CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';
import { Request } from 'express';

const LYNX_ORIGINS = ['https://lynxtour.cn', 'https://www.lynxtour.cn'];

export function createCorsOptions(
  businessOrigins: string[],
): CorsOptionsDelegate<Request> {
  return (request, callback) => {
    const path = request.path.replace(/\/$/, '').toLowerCase();
    const isRegistryRequest =
      path === '/v1/whatsapp/register' &&
      ['POST', 'OPTIONS'].includes(request.method) &&
      LYNX_ORIGINS.includes(request.get('origin') ?? '');
    const isLynxHealthRequest =
      path === '/api/health' &&
      ['GET', 'OPTIONS'].includes(request.method) &&
      LYNX_ORIGINS.includes(request.get('origin') ?? '');
    if (path.startsWith('/v1/private/whatsapp/')) {
      callback(null, { origin: false });
      return;
    }

    callback(
      null,
      isRegistryRequest || isLynxHealthRequest
        ? {
            origin: LYNX_ORIGINS,
            credentials: false,
            methods: isLynxHealthRequest
              ? ['GET', 'OPTIONS']
              : ['POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type'],
          }
        : { origin: businessOrigins, credentials: true },
    );
  };
}
