import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import type { Params } from 'nestjs-pino';

interface HttpLogSource {
  context: string;
  handler?: string;
  params?: unknown;
  query?: unknown;
  body?: unknown;
}

type HttpResponse = ServerResponse & {
  locals?: { httpLogSource?: HttpLogSource };
};

const HIDDEN_NEST_STARTUP_LOG_CONTEXTS = new Set([
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
]);

const SENSITIVE_FIELD_PARTS = [
  'authorization',
  'cookie',
  'password',
  'token',
  'secret',
  'credential',
  'apikey',
  'privatekey',
];

const MAX_LOG_VALUE_DEPTH = 6;
const MAX_LOG_STRING_LENGTH = 4_000;
const MAX_LOG_ARRAY_ITEMS = 100;
const MAX_LOG_OBJECT_FIELDS = 100;

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

function isSensitiveField(field: string): boolean {
  const normalized = field.replace(/[-_]/g, '').toLowerCase();
  return SENSITIVE_FIELD_PARTS.some((part) => normalized.includes(part));
}

function sanitizeLogValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return value.length <= MAX_LOG_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_LOG_STRING_LENGTH)}…[TRUNCATED]`;
  }
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `[BINARY ${value.length} bytes]`;
  if (value === undefined) return '[UNDEFINED]';
  if (typeof value === 'symbol') return `[SYMBOL ${value.description ?? ''}]`;
  if (typeof value === 'function')
    return `[FUNCTION ${value.name || 'anonymous'}]`;
  if (typeof value !== 'object') return '[UNSUPPORTED]';
  if (depth >= MAX_LOG_VALUE_DEPTH) return '[TRUNCATED: max depth]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_LOG_ARRAY_ITEMS)
      .map((item) => sanitizeLogValue(item, depth + 1, seen));
    if (value.length > MAX_LOG_ARRAY_ITEMS) {
      result.push(`[TRUNCATED: ${value.length - MAX_LOG_ARRAY_ITEMS} items]`);
    }
    return result;
  }

  const entries = Object.entries(value);
  const result = entries
    .slice(0, MAX_LOG_OBJECT_FIELDS)
    .map(([key, item]) => [
      key,
      isSensitiveField(key)
        ? '[REDACTED]'
        : sanitizeLogValue(item, depth + 1, seen),
    ]);
  if (entries.length > MAX_LOG_OBJECT_FIELDS) {
    result.push([
      '__truncated__',
      `[${entries.length - MAX_LOG_OBJECT_FIELDS} more fields]`,
    ]);
  }
  return Object.fromEntries(result);
}

function hasLogValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function requestLogDetails(
  source: HttpLogSource | undefined,
): Record<string, unknown> {
  return {
    ...(hasLogValue(source?.params)
      ? { params: sanitizeLogValue(source?.params) }
      : {}),
    ...(hasLogValue(source?.query)
      ? { query: sanitizeLogValue(source?.query) }
      : {}),
    ...(hasLogValue(source?.body)
      ? { body: sanitizeLogValue(source?.body) }
      : {}),
  };
}

function httpLogObject(
  request: IncomingMessage,
  response: ServerResponse,
  durationMs: number,
): Record<string, unknown> {
  const source = (response as HttpResponse).locals?.httpLogSource;
  const path = requestPath(request);
  return {
    method: request.method ?? '-',
    path,
    statusCode: response.statusCode,
    durationMs,
    context: source?.context ?? 'HTTP',
    ...(source?.handler ? { handler: source.handler } : {}),
    ...requestLogDetails(source),
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
                  'context,handler,requestId,method,path,statusCode,durationMs,params,query,body,req,res,responseTime',
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
