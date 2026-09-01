import { HttpException, HttpStatus } from '@nestjs/common';

export class ApplicationError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details: Record<string, unknown> = {},
  ) {
    super({ code, message, details }, status);
  }
}
