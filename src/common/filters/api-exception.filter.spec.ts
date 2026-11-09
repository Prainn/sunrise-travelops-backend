import { ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ErrorCode } from '../constants/error-code';
import { BusinessException } from '../exceptions/business.exception';
import {
  ApiExceptionFilter,
  normalizeDatabaseError,
} from './api-exception.filter';

// Local response mocks only; no database connection or application bootstrap.
describe('API error messages', () => {
  function respond(exception: unknown) {
    const response = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          path: '/api/test',
          originalUrl: '/api/test',
          headers: {},
        }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    new ApiExceptionFilter().catch(exception, host);
    return response;
  }

  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [400, ErrorCode.BAD_REQUEST],
    [401, ErrorCode.AUTH_TOKEN_INVALID],
    [403, ErrorCode.AUTH_FORBIDDEN],
    [404, ErrorCode.NOT_FOUND],
    [409, ErrorCode.CONFLICT],
    [429, ErrorCode.TOO_MANY_REQUESTS],
    [418, ErrorCode.INTERNAL_SERVER_ERROR],
    [500, ErrorCode.INTERNAL_SERVER_ERROR],
    [503, ErrorCode.INTERNAL_SERVER_ERROR],
  ])('returns an empty fallback for HTTP %s', (status, code) => {
    const response = respond(new HttpException('Framework default', status));
    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code, message: '', data: null, details: {} }),
    );
  });

  it.each([undefined, null, [], 123])(
    'returns an empty fallback for a coded error with message %p',
    (message) => {
      const response = respond(
        new HttpException(
          { code: ErrorCode.CONFLICT, message, details: { version: 2 } },
          409,
        ),
      );
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCode.CONFLICT,
          message: '',
          details: { version: 2 },
        }),
      );
    },
  );

  it.each([
    [403, ErrorCode.AUTH_FORBIDDEN, '只能删除当前本人负责的询盘'],
    [403, ErrorCode.AUTH_FORBIDDEN, '无独立站访问权限'],
    [409, ErrorCode.CONFLICT, '台账已有有效旅行团'],
    [404, ErrorCode.NOT_FOUND, '旅行团不存在'],
    [503, ErrorCode.FEISHU_NOT_CONFIGURED, '未配置飞书通知'],
  ] as const)(
    'preserves the specific reason for %s/%s',
    (status, code, message) => {
      const response = respond(
        new BusinessException({
          status,
          code,
          message,
          details: { reason: 'test' },
        }),
      );
      expect(response.status).toHaveBeenCalledWith(status);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code,
          message,
          details: status >= 500 ? {} : { reason: 'test' },
        }),
      );
    },
  );

  it('hides internal reasons and leaves unexpected failures to localization', () => {
    for (const error of [
      new Error('private SQL'),
      new HttpException(
        { code: ErrorCode.CONFLICT, message: 'private SQL' },
        500,
      ),
      new QueryFailedError('private SQL', [], new Error('database failure')),
    ]) {
      const response = respond(error);
      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCode.INTERNAL_SERVER_ERROR,
          message: '',
          details: {},
        }),
      );
    }
  });

  it('uses an empty generic database conflict while preserving known reasons', () => {
    expect(normalizeDatabaseError({ code: '23514' })).toMatchObject({
      status: 409,
      code: ErrorCode.DATABASE_CONSTRAINT_VIOLATION,
      message: '',
    });
    expect(
      normalizeDatabaseError({
        code: '23505',
        constraint: 'UQ_resource_cars_code',
      }),
    ).toMatchObject({
      status: 409,
      code: ErrorCode.RESOURCE_CODE_EXISTS,
      message: '资源编码已存在',
    });
  });
});
