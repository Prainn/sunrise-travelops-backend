import {
  Body,
  Controller,
  Get,
  HttpStatus,
  INestApplication,
  Logger,
  Post,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IsInt, Min } from 'class-validator';
import type { Server } from 'node:http';
import { Logger as PinoNestLogger, LoggerModule } from 'nestjs-pino';
import type { Options } from 'pino-http';
import request from 'supertest';
import { ErrorCode } from '../src/common/constants/error-code';
import { BusinessException } from '../src/common/exceptions/business.exception';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { HttpLogContextInterceptor } from '../src/common/interceptors/http-log-context.interceptor';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { createValidationException } from '../src/common/validation/validation-exception.factory';
import { createLoggerModuleOptions } from '../src/config/logger';

class LoggingInputDto {
  @IsInt()
  @Min(1)
  count: number;
}

@Controller('logging')
class LoggingController {
  private readonly logger = new Logger(LoggingController.name);

  @Get('ok')
  ok() {
    return { ok: true };
  }

  @Post('created')
  created(@Body() input: LoggingInputDto) {
    return input;
  }

  @Get('business')
  business() {
    this.logger.log('Business log marker');
    return { ok: true };
  }

  @Get('unauthorized')
  unauthorized(): never {
    throw new BusinessException({
      code: ErrorCode.AUTH_TOKEN_INVALID,
      message: '访问令牌无效',
      status: HttpStatus.UNAUTHORIZED,
    });
  }

  @Get('forbidden')
  forbidden(): never {
    throw new BusinessException({
      code: ErrorCode.AUTH_FORBIDDEN,
      message: '没有权限执行此操作',
      status: HttpStatus.FORBIDDEN,
    });
  }

  @Get('missing')
  missing(): never {
    throw new BusinessException({
      code: ErrorCode.NOT_FOUND,
      message: '请求的资源不存在',
      status: HttpStatus.NOT_FOUND,
    });
  }

  @Get('internal-error')
  internalError(): never {
    throw new Error('LOGGING_TEST_ERROR');
  }
}

@Controller('health')
class LoggingHealthController {
  @Get()
  health() {
    return { status: 'ok' };
  }
}

@Controller('v1')
class ExcludedLoggingController {
  @Post('whatsapp/register')
  register() {
    return { recorded: true };
  }
}

type LogRecord = Record<string, unknown>;

describe('structured HTTP logging (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  const output: string[] = [];

  beforeAll(async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const loggerOptions = createLoggerModuleOptions([
      ExcludedLoggingController,
    ]);
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    const destination = {
      write(message: string) {
        output.push(message);
      },
    };

    const module = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          ...loggerOptions,
          pinoHttp: [loggerOptions.pinoHttp as Options, destination],
        }),
      ],
      controllers: [
        LoggingController,
        LoggingHealthController,
        ExcludedLoggingController,
      ],
      providers: [
        {
          provide: APP_INTERCEPTOR,
          useClass: HttpLogContextInterceptor,
        },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();

    app = module.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(PinoNestLogger));
    app.setGlobalPrefix('api', {
      exclude: [{ path: 'v1/whatsapp/register', method: RequestMethod.POST }],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: createValidationException,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    server = app.getHttpServer() as Server;
    output.length = 0;
  });

  afterAll(async () => app.close());

  function records(): LogRecord[] {
    return output
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogRecord);
  }

  it('emits one compact structured completion log for 200 and 201', async () => {
    await request(server)
      .get('/api/logging/ok?ignored=true')
      .set('X-Request-Id', 'request-ok-1')
      .set('Authorization', 'Bearer TOP_SECRET_ACCESS')
      .set('Cookie', 'session=TOP_SECRET_COOKIE')
      .expect(HttpStatus.OK);
    await request(server)
      .post('/api/logging/created')
      .set('X-Request-Id', 'request-created-1')
      .send({ count: 1, password: 'TOP_SECRET_PASSWORD' })
      .expect(HttpStatus.BAD_REQUEST);
    await request(server)
      .post('/api/logging/created')
      .set('X-Request-Id', 'request-created-2')
      .send({ count: 1 })
      .expect(HttpStatus.CREATED);

    const httpLogs = records().filter((log) =>
      String(log.msg).startsWith('HTTP request'),
    );
    expect(httpLogs).toHaveLength(3);
    expect(httpLogs[0]).toMatchObject({
      level: 'info',
      requestId: 'request-ok-1',
      method: 'GET',
      path: '/api/logging/ok',
      statusCode: 200,
      context: 'LoggingController',
      handler: 'ok',
      msg: 'HTTP request completed',
    });
    expect(httpLogs[1]).toMatchObject({
      level: 'warn',
      statusCode: 400,
      msg: 'HTTP request failed',
    });
    expect(httpLogs[2]).toMatchObject({
      level: 'info',
      statusCode: 201,
      msg: 'HTTP request completed',
    });
    for (const log of httpLogs) {
      expect(log.time).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
      expect(log.durationMs).toEqual(expect.any(Number));
      expect(log).not.toHaveProperty('pid');
      expect(log).not.toHaveProperty('hostname');
      expect(log).not.toHaveProperty('req');
      expect(log).not.toHaveProperty('res');
      expect(log).not.toHaveProperty('headers');
      expect(log).not.toHaveProperty('body');
    }
    expect(output.join('')).not.toContain('TOP_SECRET');
  });

  it.each([
    ['unauthorized', HttpStatus.UNAUTHORIZED],
    ['forbidden', HttpStatus.FORBIDDEN],
    ['missing', HttpStatus.NOT_FOUND],
  ])('emits one warn completion log for %s', async (path, status) => {
    output.length = 0;
    await request(server).get(`/api/logging/${path}`).expect(status);
    const matching = records().filter(
      (log) => log.path === `/api/logging/${path}`,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      level: 'warn',
      statusCode: status,
      context: 'LoggingController',
      handler: path,
      msg: 'HTTP request failed',
    });
  });

  it('keeps one HTTP failure log and one real exception log for 500', async () => {
    output.length = 0;
    await request(server)
      .get('/api/logging/internal-error')
      .set('X-Request-Id', 'request-error-1')
      .expect(HttpStatus.INTERNAL_SERVER_ERROR);
    const matching = records().filter(
      (log) => log.requestId === 'request-error-1',
    );
    expect(matching).toHaveLength(2);
    expect(matching).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          statusCode: 500,
          context: 'LoggingController',
          handler: 'internalError',
          msg: 'HTTP request failed',
        }),
        expect.objectContaining({
          level: 'error',
          errorName: 'Error',
          errorMessage: 'LOGGING_TEST_ERROR',
          context: 'LoggingController',
          handler: 'internalError',
          msg: 'Unhandled request exception',
        }),
      ]),
    );
    const exceptionLog = matching.find(
      (log) => log.msg === 'Unhandled request exception',
    );
    expect(exceptionLog?.stack).toEqual(
      expect.stringContaining('LOGGING_TEST_ERROR'),
    );
    expect(matching.every((log) => !('req' in log) && !('res' in log))).toBe(
      true,
    );
  });

  it('suppresses successful health access logs without hiding business logs', async () => {
    output.length = 0;
    await request(server).get('/api/health').expect(HttpStatus.OK);
    await request(server).get('/api/health').expect(HttpStatus.OK);
    expect(records().filter((log) => log.path === '/api/health')).toHaveLength(
      0,
    );

    await request(server)
      .get('/api/logging/business')
      .set('X-Request-Id', 'request-business-1')
      .expect(HttpStatus.OK);
    expect(records()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          requestId: 'request-business-1',
          context: 'LoggingController',
          msg: 'Business log marker',
        }),
      ]),
    );
  });

  it('logs routes excluded from the global API prefix exactly once', async () => {
    output.length = 0;
    await request(server)
      .post('/v1/whatsapp/register')
      .set('X-Request-Id', 'request-whatsapp-1')
      .send({})
      .expect(HttpStatus.CREATED);
    const matching = records().filter(
      (log) => log.requestId === 'request-whatsapp-1',
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      level: 'info',
      method: 'POST',
      path: '/v1/whatsapp/register',
      statusCode: 201,
      context: 'ExcludedLoggingController',
      handler: 'register',
      msg: 'HTTP request completed',
    });
  });
});
