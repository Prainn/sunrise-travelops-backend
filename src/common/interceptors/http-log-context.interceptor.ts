import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';

@Injectable()
export class HttpLogContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const response = context.switchToHttp().getResponse<Response>();
      response.locals.httpLogSource = {
        context: context.getClass().name,
        handler: context.getHandler().name,
      };
    }

    return next.handle();
  }
}
