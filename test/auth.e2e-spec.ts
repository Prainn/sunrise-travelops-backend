import {
  Controller,
  Get,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Server } from 'node:http';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
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

  beforeEach(async () => {
    storedUser = Object.assign(new UserEntity(), {
      id: 'eb225323-231d-4613-838c-29a9cd21c4cf',
      username: 'coordinator',
      nickname: 'Coordinator',
      avatar: '',
      gender: 0,
      mobile: '',
      email: '',
      deptId: 3,
      passwordHash: await argon2.hash('123456'),
      refreshTokenHash: null,
      status: UserStatus.Enabled,
      roles: [
        {
          isEnabled: true,
          permissions: [{ code: 'sys:user:update' }],
        },
      ],
    });
    const users = {
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
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  it('logs in, authorizes access, rotates refresh tokens and rejects missing permission', async () => {
    const login = await request(server)
      .post('/api/auth/login')
      .send({ username: 'coordinator', password: '123456' })
      .expect(200);

    expect(login.body).toMatchObject({ tokenType: 'Bearer' });
    const loginTokens = parseAuthTokens(login.body as unknown);
    expect(loginTokens.accessToken.length).toBeLessThan(500);
    expect(decodeJwtPayload(loginTokens.accessToken)).toMatchObject({
      sub: storedUser.id,
      type: 'access',
    });
    expect(decodeJwtPayload(loginTokens.accessToken)).not.toHaveProperty(
      'permissions',
    );
    await request(server)
      .get('/api/protected/users')
      .set('Authorization', `Bearer ${loginTokens.accessToken}`)
      .expect(200, { ok: true });

    const refresh = await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken: loginTokens.refreshToken })
      .expect(200);
    const refreshedTokens = parseAuthTokens(refresh.body as unknown);
    expect(refreshedTokens.refreshToken).not.toBe(loginTokens.refreshToken);

    const denied = await request(server)
      .get('/api/protected/roles')
      .set('Authorization', `Bearer ${refreshedTokens.accessToken}`)
      .expect(403);
    expect(denied.body).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('throttles repeated login attempts', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server)
        .post('/api/auth/login')
        .send({ username: 'coordinator', password: 'wrong-password' })
        .expect(401);
    }
    await request(server)
      .post('/api/auth/login')
      .send({ username: 'coordinator', password: 'wrong-password' })
      .expect(429);
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

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('Expected a JWT payload');
  return JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}
