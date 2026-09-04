import {
  Body,
  Controller,
  Get,
  Header,
  HttpStatus,
  INestApplication,
  Post,
  StreamableFile,
  ValidationPipe,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IsInt, Matches, Min, MinLength } from 'class-validator';
import { Server } from 'node:http';
import request from 'supertest';
import { ErrorCode } from '../src/common/constants/error-code';
import { SkipResponseWrap } from '../src/common/decorators/skip-response-wrap.decorator';
import { BusinessException } from '../src/common/exceptions/business.exception';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { createValidationException } from '../src/common/validation/validation-exception.factory';

interface ValidationErrorBody {
  code: string;
  message: string;
  data: null;
  details: Record<string, string[]>;
  timestamp: string;
  path: string;
  requestId?: string;
}

class ContractInputDto {
  @MinLength(3)
  @Matches(/^[a-z]+$/, { message: '用户名格式不正确' })
  username: string;

  @IsInt()
  @Min(1)
  age: number;
}

@Controller('contract')
class ContractController {
  @Get('object')
  object() {
    return { id: 'one' };
  }

  @Get('array')
  array() {
    return [];
  }

  @Get('page')
  page() {
    return { list: [], total: 0, page: 1, pageSize: 20 };
  }

  @Post('validation')
  validation(@Body() input: ContractInputDto) {
    return input;
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
      code: ErrorCode.USER_NOT_FOUND,
      message: '用户不存在',
      status: HttpStatus.NOT_FOUND,
    });
  }

  @Get('conflict')
  conflict(): never {
    throw new BusinessException({
      code: ErrorCode.RESOURCE_VERSION_CONFLICT,
      message: '资源已被其他请求修改',
      status: HttpStatus.CONFLICT,
      details: { expectedVersion: 1, actualVersion: 2 },
    });
  }

  @Get('internal-error')
  internalError(): never {
    throw new Error('SECRET_STACK_MARKER internal SQL /private/service.ts');
  }

  @Get('document.pdf')
  @Header('Content-Type', 'application/pdf')
  @SkipResponseWrap()
  document(): StreamableFile {
    return new StreamableFile(Buffer.from('%PDF-1.4 test'));
  }
}

describe('API response contract (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ContractController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: ResponseInterceptor }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useLogger(false);
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
  });

  afterAll(async () => app.close());

  it('wraps object, array, and paginated success data', async () => {
    await request(server)
      .get('/api/contract/object')
      .expect(200, {
        code: 'SUCCESS',
        message: 'success',
        data: { id: 'one' },
      });
    await request(server).get('/api/contract/array').expect(200, {
      code: 'SUCCESS',
      message: 'success',
      data: [],
    });
    await request(server)
      .get('/api/contract/page')
      .expect(200, {
        code: 'SUCCESS',
        message: 'success',
        data: { list: [], total: 0, page: 1, pageSize: 20 },
      });
  });

  it('returns stable field details for validation errors', async () => {
    const response = await request(server)
      .post('/api/contract/validation')
      .set('X-Request-Id', 'request-validation-1')
      .send({ username: 'A', age: 0, unexpected: true })
      .expect(HttpStatus.BAD_REQUEST);
    const body = response.body as unknown as ValidationErrorBody;

    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '请求参数校验失败',
      data: null,
      details: {
        age: ['数值低于下限'],
        unexpected: ['不允许提交该字段'],
      },
      path: '/api/contract/validation',
      requestId: 'request-validation-1',
    });
    expect(body.details.username).toEqual(
      expect.arrayContaining(['用户名格式不正确', '长度不足']),
    );
    expect(body.timestamp).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toMatch(/must|should|property/);
  });

  it.each([
    ['unauthorized', HttpStatus.UNAUTHORIZED, 'AUTH_TOKEN_INVALID'],
    ['forbidden', HttpStatus.FORBIDDEN, 'AUTH_FORBIDDEN'],
    ['missing', HttpStatus.NOT_FOUND, 'USER_NOT_FOUND'],
    ['conflict', HttpStatus.CONFLICT, 'RESOURCE_VERSION_CONFLICT'],
  ])(
    'preserves %s HTTP status and business code',
    async (path, status, code) => {
      const response = await request(server)
        .get(`/api/contract/${path}`)
        .expect(status);
      expect(response.body).toMatchObject({ code, data: null, details: {} });
    },
  );

  it('does not expose internal exception details on 500', async () => {
    const response = await request(server)
      .get('/api/contract/internal-error')
      .expect(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.body).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: '服务器内部错误',
      data: null,
      details: {},
    });
    expect(JSON.stringify(response.body)).not.toContain('SECRET_STACK_MARKER');
    expect(response.body).not.toHaveProperty('stack');
  });

  it('returns PDF bytes without a JSON envelope', async () => {
    const response = await request(server)
      .get('/api/contract/document.pdf')
      .buffer(true)
      .parse((incoming, callback) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(HttpStatus.OK)
      .expect('Content-Type', /application\/pdf/);
    expect(response.body).toEqual(Buffer.from('%PDF-1.4 test'));
  });
});
