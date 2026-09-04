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

interface ErrorBody {
  code?: string;
  message?: string | string[];
  details?: Record<string, unknown>;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const { status, code, message, details } = this.normalize(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
  }

  private normalize(exception: unknown): {
    status: number;
    code: string;
    message: string | string[];
    details: Record<string, unknown>;
  } {
    if (exception instanceof QueryFailedError) {
      const driverError = exception.driverError as {
        code?: unknown;
        constraint?: unknown;
      };
      if (
        driverError.code === '23505' &&
        typeof driverError.constraint === 'string'
      ) {
        if (/^UQ_resource_.+_code$/.test(driverError.constraint)) {
          return {
            status: HttpStatus.CONFLICT,
            code: 'RESOURCE_CODE_EXISTS',
            message: 'Resource code already exists',
            details: {},
          };
        }
        if (
          driverError.constraint ===
          'UQ_resource_agency_contacts_agency_name_key'
        ) {
          return {
            status: HttpStatus.CONFLICT,
            code: 'AGENCY_CONTACT_NAME_EXISTS',
            message: 'Contact name already exists for this agency',
            details: {},
          };
        }
      }
      const isConstraintViolation =
        typeof driverError.code === 'string' &&
        driverError.code.startsWith('23');
      return {
        status: isConstraintViolation
          ? HttpStatus.CONFLICT
          : HttpStatus.INTERNAL_SERVER_ERROR,
        code: isConstraintViolation
          ? 'DATABASE_CONSTRAINT_VIOLATION'
          : 'DATABASE_OPERATION_FAILED',
        message: isConstraintViolation
          ? 'The requested change conflicts with existing data'
          : 'The database operation could not be completed',
        details: {},
      };
    }

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const normalizedBody: ErrorBody =
        typeof body === 'string' ? { message: body } : body;
      return {
        status: exception.getStatus(),
        code: normalizedBody.code ?? this.codeFromStatus(exception.getStatus()),
        message: normalizedBody.message ?? exception.message,
        details: normalizedBody.details ?? {},
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      details: {},
    };
  }

  private codeFromStatus(status: number): string {
    return HttpStatus[status] ?? 'HTTP_ERROR';
  }
}
