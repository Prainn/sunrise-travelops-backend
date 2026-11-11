import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';

@Injectable()
export class HttpLogContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const http = context.switchToHttp();
      const request = http.getRequest<Request>();
      const response = http.getResponse<Response>();
      response.locals.httpLogSource = {
        context: context.getClass().name,
        handler: context.getHandler().name,
        params: request.params,
        query: context.getClass().name.startsWith('Whatsapp')
          ? undefined
          : request.query,
        body: [
          'InspectionAlertController',
          'WhatsappController',
          'WhatsappIngressController',
        ].includes(context.getClass().name)
          ? undefined
          : (request.body as unknown),
      };
    }

    return next.handle();
  }
}
