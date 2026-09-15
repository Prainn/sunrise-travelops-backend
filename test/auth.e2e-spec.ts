import { UserIdentityEntity } from '../src/users/user-identity.entity';
import { UserLoginRecordEntity } from '../src/auth/user-login-record.entity';
import {
  Controller,
  Get,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Server } from 'node:http';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { AuthTokens } from '../src/auth/auth.types';
import { Permissions } from '../src/auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { createValidationException } from '../src/common/validation/validation-exception.factory';
import { UserEntity, UserStatus } from '../src/users/user.entity';

@Controller('protected')
class ProtectedController {
  @Get('users')
  @Permissions('sys:user:update')
  users(): { ok: true } {
    return { ok: true };
  }

  @Get('roles')
  @Permissions('sys:role:update')
  roles(): { ok: true } {
    return { ok: true };
  }
}

describe('Auth API (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let storedUser: UserEntity;
  let storedIdentity: UserIdentityEntity;

  beforeEach(async () => {
    storedUser = Object.assign(new UserEntity(), {
      id: 'eb225323-231d-4613-838c-29a9cd21c4cf',
      username: 'coordinator',
      nickname: 'Coordinator',
      avatar: '',
      gender: 0,
      mobile: '',
      email: '',
      passwordHash: await argon2.hash('123456'),
      status: UserStatus.Enabled,
    });
    storedIdentity = Object.assign(new UserIdentityEntity(), {
      id: 'eb225323-231d-4613-838c-29a9cd21c4aa',
      userId: storedUser.id,
      username: storedUser.username,
      scope: 'shengxu',
      deptId: 3,
      user: storedUser,
      roles: [{ code: 'BUSINESS_MANAGER', isEnabled: true }],
      refreshTokenHash: null,
    });
    const users = {
      manager: {
        findOne: jest.fn(
          (_entity: unknown, { where }: { where: Record<string, unknown> }) =>
            Promise.resolve(
              Object.entries(where).every(
                ([key, value]) =>
                  storedIdentity[key as keyof UserIdentityEntity] === value,
              )
                ? storedIdentity
                : null,
            ),
        ),
        save: jest.fn((identity: UserIdentityEntity) =>
          Promise.resolve(identity),
        ),
        update: jest.fn(
          (
            _entity: unknown,
            _id: unknown,
            change: Partial<UserIdentityEntity>,
          ) => {
            Object.assign(storedIdentity, change);
            return Promise.resolve({ affected: 1 });
          },
        ),
      },
      findOne: jest.fn(
        ({ where }: { where: { id?: string; username?: string } }) => {
          if (where.id && where.id !== storedUser.id) return null;
          if (where.username && where.username !== storedUser.username)
            return null;
          return Promise.resolve(
            storedUser.status === UserStatus.Enabled ? storedUser : null,
          );
        },
      ),
      save: jest.fn((user: UserEntity) => {
        storedUser = user;
        return Promise.resolve(user);
      }),
      update: jest.fn((_id: string, change: Partial<UserEntity>) => {
        Object.assign(storedUser, change);
        return Promise.resolve({ affected: 1 });
      }),
    } as unknown as Repository<UserEntity>;

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_SECRET: 'test-access-secret-that-is-at-least-32-characters',
              JWT_EXPIRES_IN: '15m',
              REFRESH_TOKEN_SECRET:
                'test-refresh-secret-that-is-different-and-long',
              REFRESH_TOKEN_EXPIRES_IN: '7d',
            }),
          ],
        }),
        PassportModule,
        JwtModule.register({}),
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
      ],
      controllers: [AuthController, ProtectedController],
      providers: [
        AuthService,
        JwtStrategy,
        { provide: getRepositoryToken(UserEntity), useValue: users },
        {
          provide: getRepositoryToken(UserLoginRecordEntity),
          useValue: {
            create: jest.fn((v) => v as UserLoginRecordEntity),
            save: jest.fn((v) => Promise.resolve(v as UserLoginRecordEntity)),
          },
        },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: createValidationException,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  it('logs in, authorizes access, rotates refresh tokens and rejects missing permission', async () => {
    const login = await request(server)
      .post('/api/auth/login')
      .send({ scope: 'shengxu', username: 'coordinator', password: '123456' })
      .expect(200);

    expect(login.body).toMatchObject({
      code: 'SUCCESS',
      message: 'success',
      data: { tokenType: 'Bearer' },
    });
    const loginTokens = parseAuthTokens(responseData(login.body as unknown));
    expect(loginTokens.accessToken.length).toBeLessThan(500);
    expect(decodeJwtPayload(loginTokens.accessToken)).toMatchObject({
      sub: storedUser.id,
      identityId: storedIdentity.id,
      scope: 'shengxu',
      type: 'access',
    });
    expect(decodeJwtPayload(loginTokens.accessToken)).not.toHaveProperty(
      'permissions',
    );
    await request(server)
      .get('/api/protected/users')
      .set('Authorization', `Bearer ${loginTokens.accessToken}`)
      .expect(200, {
        code: 'SUCCESS',
        message: 'success',
        data: { ok: true },
      });

    const refresh = await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken: loginTokens.refreshToken })
      .expect(200);
    const refreshedTokens = parseAuthTokens(
      responseData(refresh.body as unknown),
    );
    expect(refreshedTokens.refreshToken).not.toBe(loginTokens.refreshToken);

    const denied = await request(server)
      .get('/api/protected/roles')
      .set('Authorization', `Bearer ${refreshedTokens.accessToken}`)
      .expect(403);
    expect(denied.body).toMatchObject({
      code: 'AUTH_FORBIDDEN',
      data: null,
    });
  });

  it('throttles repeated login attempts', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejected = await request(server)
        .post('/api/auth/login')
        .send({
          scope: 'shengxu',
          username: 'coordinator',
          password: 'wrong-password',
        })
        .expect(401);
      expect(rejected.body).toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
        data: null,
      });
    }
    const throttled = await request(server)
      .post('/api/auth/login')
      .send({
        scope: 'shengxu',
        username: 'coordinator',
        password: 'wrong-password',
      })
      .expect(429);
    expect(throttled.body).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      data: null,
    });
  });
});

function parseAuthTokens(value: unknown): AuthTokens {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('accessToken' in value) ||
    typeof value.accessToken !== 'string' ||
    !('refreshToken' in value) ||
    typeof value.refreshToken !== 'string' ||
    !('expiresIn' in value) ||
    typeof value.expiresIn !== 'number'
  ) {
    throw new Error('Expected an authentication token response');
  }
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresIn: value.expiresIn,
    tokenType: 'Bearer',
  };
}

function responseData(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('data' in value)) {
    throw new Error('Expected an API success response');
  }
  return value.data;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('Expected a JWT payload');
  return JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}
