import { Readable } from 'node:stream';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { Observable, map } from 'rxjs';
import { SKIP_RESPONSE_WRAP_KEY } from '../decorators/skip-response-wrap.decorator';
import { ApiResponse } from '../interfaces/api-response.interface';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T | null> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T | null> | T> {
    const skipWrap = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_WRAP_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipWrap) return next.handle();

    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((data) => {
        if (
          response.statusCode === 204 ||
          this.isDirectResponse(data, response)
        ) {
          return data;
        }
        return {
          code: 'SUCCESS',
          message: 'success',
          data: data ?? null,
        };
      }),
    );
  }

  private isDirectResponse(data: T, response: Response): boolean {
    if (
      data instanceof StreamableFile ||
      Buffer.isBuffer(data) ||
      data instanceof Uint8Array ||
      data instanceof Readable
    ) {
      return true;
    }

    const contentType = response.getHeader('content-type');
    return (
      typeof contentType === 'string' &&
      !contentType.includes('application/json') &&
      !contentType.includes('+json')
    );
  }
}
