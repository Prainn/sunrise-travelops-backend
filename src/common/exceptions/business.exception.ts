import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCodeValue } from '../constants/error-code';

export interface BusinessExceptionOptions {
  code: ErrorCodeValue;
  message: string;
  status: HttpStatus;
  details?: Record<string, unknown>;
}

export class BusinessException extends HttpException {
  readonly code: ErrorCodeValue;
  readonly details: Record<string, unknown>;

  constructor(options: BusinessExceptionOptions) {
    const details = options.details ?? {};
    super(
      {
        code: options.code,
        message: options.message,
        details,
      },
      options.status,
    );
    this.code = options.code;
    this.details = details;
  }
}
