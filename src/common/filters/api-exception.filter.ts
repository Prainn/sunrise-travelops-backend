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
import { ErrorCode, ErrorCodeValue } from '../constants/error-code';
import { ApiErrorResponse } from '../interfaces/api-error-response.interface';

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
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestContext>();
    const response = http.getResponse<Response>();
    const normalized = this.normalize(exception);
    const requestId = this.requestId(request);
    const userId =
      typeof request.user?.id === 'string' ? request.user.id : undefined;
    const logContext = {
      requestId,
      userId,
      method: request.method,
      path: request.originalUrl,
      statusCode: normalized.status,
      code: normalized.code,
    };

    if (normalized.status >= 500) {
      this.logger.error({
        ...logContext,
        message: 'Unhandled request exception',
        err: exception,
      });
    } else {
      this.logger.warn({ ...logContext, message: 'Request rejected' });
    }

    const body: ApiErrorResponse = {
      code: normalized.code,
      message: normalized.message,
      data: null,
      details: normalized.details,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
      ...(requestId ? { requestId } : {}),
    };
    response.status(normalized.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof QueryFailedError) {
      return this.normalizeQueryError(exception.driverError as unknown);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        return {
          status,
          code: ErrorCode.INTERNAL_SERVER_ERROR,
          message: '服务器内部错误',
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
          message:
            typeof body.message === 'string'
              ? body.message
              : this.messageFromStatus(status),
          details: this.isRecord(body.details) ? body.details : {},
        };
      }
      return {
        status,
        code: this.codeFromStatus(status),
        message: this.messageFromStatus(status),
        details: {},
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: '服务器内部错误',
      details: {},
    };
  }

  private normalizeQueryError(driverErrorValue: unknown): NormalizedError {
    const driverError = driverErrorValue as {
      code?: unknown;
      constraint?: unknown;
    };
    if (
      driverError.code === '23505' &&
      typeof driverError.constraint === 'string'
    ) {
      if (driverError.constraint === 'UQ_resource_guides_service')
        return {
          status: HttpStatus.CONFLICT,
          code: 'GUIDE_SERVICE_EXISTS',
          message: '该第二语种与进店组合的导游价格已存在',
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
      if (
        driverError.constraint === 'UQ_resource_agency_contacts_agency_name_key'
      ) {
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.AGENCY_CONTACT_NAME_EXISTS,
          message: '该旅行社下已存在同名联系人',
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
      message: isConstraintViolation
        ? '请求的数据与现有数据冲突'
        : '服务器内部错误',
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

  private messageFromStatus(status: number): string {
    if (status >= 500) return '服务器内部错误';
    const messages: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: '请求参数错误',
      [HttpStatus.UNAUTHORIZED]: '身份认证失败',
      [HttpStatus.FORBIDDEN]: '没有权限执行此操作',
      [HttpStatus.NOT_FOUND]: '请求的资源不存在',
      [HttpStatus.CONFLICT]: '请求与当前状态冲突',
      [HttpStatus.TOO_MANY_REQUESTS]: '请求过于频繁，请稍后重试',
      [HttpStatus.INTERNAL_SERVER_ERROR]: '服务器内部错误',
    };
    return messages[status] ?? '请求处理失败';
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
}
