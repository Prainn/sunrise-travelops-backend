import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { OperationLogsService } from '../../operation-logs/operation-logs.service';
import { BusinessException } from '../exceptions/business.exception';
import { ErrorCode, ErrorCodeValue } from '../constants/error-code';
import { ApiErrorResponse } from '../interfaces/api-error-response.interface';
import { privateRequestPath } from '../http/private-request-path';

interface ErrorBody {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

interface NormalizedError {
  status: number;
  code: ErrorCodeValue;
  message: string;
  details: Record<string, unknown>;
}

type RequestContext = Request & {
  id?: string | number;
  user?: { id?: unknown };
  auditRouteEntered?: boolean;
  auditGuardFailure?: (status: number, code: string) => Promise<void>;
};

interface ErrorDetails {
  errorName: string;
  errorMessage: string;
  stack?: string;
  cause?: string | Record<string, string>;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  constructor(private readonly operationLogs?: OperationLogsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestContext>();
    const response = http.getResponse<Response>();
    const normalized = this.normalize(exception, request);
    let audit: Promise<void> | undefined;
    if (request.auditGuardFailure) {
      audit = request
        .auditGuardFailure(normalized.status, normalized.code)
        .catch(() => this.logger.error('Failed to persist guard rejection'));
    } else if (
      !request.auditRouteEntered &&
      this.operationLogs &&
      /^\/(?:api|v1)(?:\/|$)/.test(request.path)
    ) {
      audit = this.operationLogs
        .append([
          {
            category: 'system',
            action: '接口路由或请求解析失败',
            success: false,
            result: 'failure',
            scope: 'unknown',
            actorId: null,
            actorName: '未认证访客',
            ip: (request.ip ?? '').slice(0, 64),
            detail: JSON.stringify({
              stage: 'before_routing',
              method: request.method,
              statusCode: normalized.status,
              errorCode: normalized.code,
            }),
          },
        ])
        .catch(() =>
          this.logger.error(
            'Failed to persist request parsing or routing error',
          ),
        );
    }
    const requestId = this.requestId(request);
    const userId =
      typeof request.user?.id === 'string' ? request.user.id : undefined;
    const suppressErrorDetails =
      request.path.startsWith('/v1/') ||
      /^\/api\/whatsapp(?:\/|$)/.test(request.path) ||
      /^\/api\/resources\/guide-people(?:\/|$)/.test(request.path);
    const source = response.locals.httpLogSource as
      | undefined
      | {
          context?: unknown;
          handler?: unknown;
        };
    const logContext = {
      userId,
      method: request.method,
      path: privateRequestPath(request.path),
      statusCode: normalized.status,
      code: normalized.code,
      ...(typeof source?.context === 'string'
        ? { context: source.context }
        : {}),
      ...(typeof source?.handler === 'string'
        ? { handler: source.handler }
        : {}),
    };

    if (normalized.status >= 500) {
      this.logger.error({
        ...logContext,
        msg: 'Unhandled request exception',
        ...(suppressErrorDetails ? {} : this.errorDetails(exception)),
      });
    }

    const body: ApiErrorResponse = {
      code: normalized.code,
      message: normalized.message,
      data: null,
      details: normalized.details,
      timestamp: new Date().toISOString(),
      path: privateRequestPath(request.originalUrl),
      ...(requestId ? { requestId } : {}),
    };
    const send = () => {
      if (response.headersSent) {
        if (!response.writableEnded) response.end();
        return;
      }
      response.status(normalized.status).json(body);
    };
    if (audit) void audit.then(send);
    else send();
  }

  private normalize(exception: unknown, request: Request): NormalizedError {
    if (exception instanceof QueryFailedError) {
      const result = normalizeDatabaseError(exception.driverError as unknown);
      if (result.code === ErrorCode.CITY_NAME_EXISTS) {
        const { name } = (request.body ?? {}) as { name?: unknown };
        if (
          typeof name === 'string' &&
          name.trim().length <= 100 &&
          name.trim()
        ) {
          result.message = `城市「${name.trim()}」已存在，请在城市库中搜索并编辑已有记录。`;
          result.details = { field: 'name', name: name.trim() };
        }
      }
      return result;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (
        exception instanceof BusinessException &&
        [
          ErrorCode.FEISHU_NOT_CONFIGURED,
          ErrorCode.FEISHU_SEND_FAILED,
          ErrorCode.INSPECTION_ALERT_UNAVAILABLE,
        ].some((code) => code === exception.code)
      ) {
        return {
          status,
          code: exception.code,
          message: exception.message,
          details: {},
        };
      }
      if (status >= 500) {
        return {
          status,
          code: ErrorCode.INTERNAL_SERVER_ERROR,
          message: '',
          details: {},
        };
      }
      const response = exception.getResponse();
      const body: ErrorBody =
        typeof response === 'object' && response !== null ? response : {};
      if (this.isErrorCode(body.code)) {
        return {
          status,
          code: body.code,
          message: typeof body.message === 'string' ? body.message : '',
          details: this.isRecord(body.details) ? body.details : {},
        };
      }
      if (status === 413) {
        const maxMiB = /\/whatsapp\/conversations\/[^/]+\/documents\/?$/.test(
          request.path,
        )
          ? 20
          : /(?:\/system\/oss\/resources|\/whatsapp\/conversations\/[^/]+\/images)\/?$/.test(
                request.path,
              )
            ? 5
            : undefined;
        return {
          status,
          code: ErrorCode.PAYLOAD_TOO_LARGE,
          message: maxMiB
            ? `上传文件不能超过 ${maxMiB} MiB，请缩小文件后重试。`
            : '提交内容过大，请减小文件或请求大小后重试。',
          details: maxMiB ? { maxBytes: maxMiB * 1024 * 1024 } : {},
        };
      }
      if (
        status === 400 &&
        typeof body.message === 'string' &&
        /^Validation failed \(uuid(?: v [^)]*)? is expected\)$/.test(
          body.message,
        )
      ) {
        return {
          status,
          code: ErrorCode.BAD_REQUEST,
          message: '记录标识格式不正确，请重新选择记录。',
          details: { reason: 'INVALID_RECORD_ID' },
        };
      }
      if (status === 405) {
        return {
          status,
          code: ErrorCode.METHOD_NOT_ALLOWED,
          message: '该接口不支持此请求方式。',
          details: {},
        };
      }
      return {
        status,
        code: this.codeFromStatus(status),
        message: '',
        details: {},
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: '',
      details: {},
    };
  }

  private codeFromStatus(status: number): ErrorCodeValue {
    const codes: Record<number, ErrorCodeValue> = {
      [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
      [HttpStatus.UNAUTHORIZED]: ErrorCode.AUTH_TOKEN_INVALID,
      [HttpStatus.FORBIDDEN]: ErrorCode.AUTH_FORBIDDEN,
      [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
      [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
      [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
      [HttpStatus.INTERNAL_SERVER_ERROR]: ErrorCode.INTERNAL_SERVER_ERROR,
    };
    return codes[status] ?? ErrorCode.INTERNAL_SERVER_ERROR;
  }

  private isErrorCode(value: unknown): value is ErrorCodeValue {
    return (
      typeof value === 'string' &&
      (Object.values(ErrorCode) as string[]).includes(value)
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private requestId(request: RequestContext): string | undefined {
    if (typeof request.id === 'string') return request.id;
    if (typeof request.id === 'number') return String(request.id);
    const header = request.headers['x-request-id'];
    return typeof header === 'string' ? header : header?.[0];
  }

  private errorDetails(exception: unknown): ErrorDetails {
    if (!(exception instanceof Error)) {
      return {
        errorName: 'UnknownError',
        errorMessage: 'Unknown non-Error exception',
      };
    }

    const cause = exception.cause;
    return {
      errorName: exception.name,
      errorMessage: exception.message,
      ...(exception.stack ? { stack: exception.stack } : {}),
      ...(cause instanceof Error
        ? {
            cause: {
              name: cause.name,
              message: cause.message,
              ...(cause.stack ? { stack: cause.stack } : {}),
            },
          }
        : typeof cause === 'string' ||
            typeof cause === 'number' ||
            typeof cause === 'boolean'
          ? { cause: String(cause) }
          : {}),
    };
  }
}

const uniqueConflicts: ReadonlyMap<string, readonly [ErrorCodeValue, string]> =
  new Map([
    [
      'UQ_resource_cities_name',
      [
        ErrorCode.CITY_NAME_EXISTS,
        '该城市名称已存在，请在城市库中搜索并编辑已有记录。',
      ],
    ],
    [
      'UQ_resource_flights_schedule',
      [
        ErrorCode.FLIGHT_SCHEDULE_EXISTS,
        '相同起降地点、航班号和起降时间的航班已存在。',
      ],
    ],
    [
      'UQ_resource_flights_airport_schedule',
      [
        ErrorCode.FLIGHT_SCHEDULE_EXISTS,
        '相同起降机场、航班号和起降时间的航班已存在。',
      ],
    ],
    [
      'whatsapp_quick_replies_stage_scenario_key',
      [
        ErrorCode.WHATSAPP_QUICK_REPLY_EXISTS,
        '该业务阶段下已有同名场景，请编辑已有快捷回复。',
      ],
    ],
    [
      'direct_ledger_website_inquiry_unique',
      [
        ErrorCode.DIRECT_LEDGER_INQUIRY_EXISTS,
        '该询盘已有关联台账，请查看已有台账。',
      ],
    ],
    [
      'UQ_identity_login',
      [
        ErrorCode.USERNAME_ALREADY_EXISTS,
        '该登录范围内已存在此用户名，请更换用户名。',
      ],
    ],
    [
      'UQ_system_dictionary_types_dict_code',
      [ErrorCode.DICTIONARY_CODE_EXISTS, '该系统分类编码已存在，请更换编码。'],
    ],
    [
      'UQ_system_dictionary_items_type_value',
      [
        ErrorCode.DICTIONARY_ITEM_VALUE_EXISTS,
        '该系统分类下已有相同的项目值。',
      ],
    ],
    [
      'UQ_system_business_dictionary_types_code',
      [
        ErrorCode.BUSINESS_DICTIONARY_TYPE_CODE_EXISTS,
        '该业务分类编码已存在，请更换编码。',
      ],
    ],
    [
      'UQ_system_business_dictionary_items_type_code',
      [
        ErrorCode.BUSINESS_DICTIONARY_ITEM_CODE_EXISTS,
        '该业务分类下已有相同的项目编码。',
      ],
    ],
    [
      'UQ_resource_guides_service',
      [ErrorCode.GUIDE_SERVICE_EXISTS, '该第二语种与进店组合的导游价格已存在'],
    ],
    [
      'UQ_resource_agency_contacts_agency_name_key',
      [ErrorCode.AGENCY_CONTACT_NAME_EXISTS, '该旅行社下已存在同名联系人'],
    ],
  ]);

export function normalizeDatabaseError(
  driverErrorValue: unknown,
): NormalizedError {
  const driverError = driverErrorValue as {
    code?: unknown;
    constraint?: unknown;
  };
  if (
    driverError.code === '23505' &&
    typeof driverError.constraint === 'string'
  ) {
    const known = uniqueConflicts.get(driverError.constraint);
    if (known)
      return {
        status: HttpStatus.CONFLICT,
        code: known[0],
        message: known[1],
        details: {},
      };
    if (/^UQ_resource_.+_code$/.test(driverError.constraint)) {
      return {
        status: HttpStatus.CONFLICT,
        code: ErrorCode.RESOURCE_CODE_EXISTS,
        message: '资源编码已存在',
        details: {},
      };
    }
  }
  const isConstraintViolation =
    typeof driverError.code === 'string' && driverError.code.startsWith('23');
  return {
    status: isConstraintViolation
      ? HttpStatus.CONFLICT
      : HttpStatus.INTERNAL_SERVER_ERROR,
    code: isConstraintViolation
      ? ErrorCode.DATABASE_CONSTRAINT_VIOLATION
      : ErrorCode.INTERNAL_SERVER_ERROR,
    message: '',
    details: {},
  };
}
