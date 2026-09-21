import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import type { Params } from 'nestjs-pino';

interface HttpLogSource {
  context: string;
  handler?: string;
}

type HttpResponse = ServerResponse & {
  locals?: { httpLogSource?: HttpLogSource };
};

const HIDDEN_NEST_STARTUP_LOG_CONTEXTS = new Set([
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
]);

const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.referer',
  'req.headers.referrer',
  'req.body',
  'res.headers["set-cookie"]',
  'authorization',
  'cookie',
  'setCookie',
  'accessToken',
  'refreshToken',
  'password',
  'oldPassword',
  'newPassword',
  'apiKey',
  'secret',
  'credential',
  '*.authorization',
  '*.cookie',
  '*.setCookie',
  '*.accessToken',
  '*.refreshToken',
  '*.password',
  '*.oldPassword',
  '*.newPassword',
  '*.apiKey',
  '*.secret',
  '*.credential',
];

function requestPath(request: IncomingMessage): string {
  return request.url?.split('?')[0] || '-';
}

function httpLogObject(
  request: IncomingMessage,
  response: ServerResponse,
  durationMs: number,
): Record<string, unknown> {
  const source = (response as HttpResponse).locals?.httpLogSource;
  return {
    method: request.method ?? '-',
    path: requestPath(request),
    statusCode: response.statusCode,
    durationMs,
    context: source?.context ?? 'HTTP',
    ...(source?.handler ? { handler: source.handler } : {}),
  };
}

function responseTime(value: unknown): number {
  if (
    typeof value === 'object' &&
    value !== null &&
    'responseTime' in value &&
    typeof value.responseTime === 'number'
  ) {
    return value.responseTime;
  }
  return 0;
}

export function createLoggerModuleOptions(
  unprefixedControllers: Type[] = [],
): Params {
  const isDevelopment = process.env.NODE_ENV === 'development';

  return {
    assignResponse: true,
    forRoutes: [
      { path: '{/*splat}', method: RequestMethod.ALL },
      ...unprefixedControllers,
    ],
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? 'info',
      base: undefined,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      ...(isDevelopment
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                ignore:
                  'context,handler,requestId,method,path,statusCode,durationMs,req,res,responseTime',
                messageFormat:
                  '{if context}[{context}]{end}{if handler}.{handler}{end} {msg}{if method} {method} {path} {statusCode} {durationMs}ms requestId={requestId}{end}',
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
              },
            },
          }
        : {
            formatters: {
              level: (label: string) => ({ level: label }),
            },
          }),
      hooks: {
        logMethod(args, method) {
          const bindings = args[0];
          const context =
            typeof bindings === 'object' &&
            bindings !== null &&
            'context' in bindings
              ? bindings.context
              : undefined;

          if (
            typeof context === 'string' &&
            HIDDEN_NEST_STARTUP_LOG_CONTEXTS.has(context)
          ) {
            return;
          }

          method.apply(this, args);
        },
      },
      genReqId: (request: IncomingMessage) =>
        request.headers['x-request-id']?.toString() ?? randomUUID(),
      quietReqLogger: true,
      quietResLogger: true,
      customAttributeKeys: { reqId: 'requestId' },
      customLogLevel: (request, response, error) => {
        if (
          requestPath(request) === '/api/health' &&
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          !error
        ) {
          return 'silent';
        }
        if (response.statusCode >= 500 || error) return 'error';
        if (response.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessObject: (request, response, value) =>
        httpLogObject(request, response, responseTime(value)),
      customErrorObject: (request, response, _error, value) =>
        httpLogObject(request, response, responseTime(value)),
      customSuccessMessage: (_request, response) =>
        response.statusCode >= 400
          ? 'HTTP request failed'
          : 'HTTP request completed',
      customErrorMessage: () => 'HTTP request failed',
      redact: {
        paths: REDACTED_LOG_PATHS,
        censor: '[REDACTED]',
      },
    },
  };
}
