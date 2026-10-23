import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import { IsNull } from 'typeorm';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './auth.types';
import { PermissionsGuard } from './guards/permissions.guard';
import { effectivePermissions } from './identity-permissions';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { createValidationException } from '../common/validation/validation-exception.factory';
import { UserStatus } from '../users/user.entity';

// Mock only authentication and persistence; exercise the real HTTP permission gate,
// DTO validation and service without connecting to any database.
describe('self-service profile authorization', () => {
  let app: INestApplication;
  let server: Server;
  let actor: AuthenticatedUser | undefined;
  const update = jest.fn().mockResolvedValue({ affected: 1 });
  const args = [
    { update },
    {},
    {},
    {},
    {},
    {},
  ] as unknown as ConstructorParameters<typeof AuthService>;
  const auth = new AuthService(...args);
  const self: AuthenticatedUser = {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'self',
    nickname: 'Self',
    identityId: 'identity',
    scope: 'shengxu',
    scopeName: '',
    deptId: null,
    deptName: '',
    roles: ['COORDINATOR'],
    permissions: [],
    menuKeys: [],
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate() {
              if (!actor) throw new UnauthorizedException();
              return true;
            },
          },
        },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(
      (req: { user?: AuthenticatedUser }, _res: unknown, next: () => void) => {
        req.user = actor;
        next();
      },
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: createValidationException,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    actor = { ...self };
    update.mockClear();
  });
  it.each(['COORDINATOR', 'RESOURCE_MANAGER', 'EXECUTIVE'])(
    '%s can edit self without sys:user:update',
    async (role) => {
      const scope = role === 'EXECUTIVE' ? 'headquarters' : 'shengxu';
      actor = {
        ...self,
        scope,
        roles: [role],
        permissions: effectivePermissions(scope, [role]),
      };
      expect(actor.permissions).not.toContain('sys:user:update');
      await request(server)
        .patch('/api/auth/me/profile')
        .send({
          nickname: ' Changed ',
          avatar: 'data:image/png;base64,AA==',
          gender: 2,
        })
        .expect(204);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: self.id,
          status: UserStatus.Enabled,
          deletedAt: IsNull(),
        }),
        {
          nickname: 'Changed',
          avatar: 'data:image/png;base64,AA==',
          gender: 2,
          updatedBy: self.id,
        },
      );
    },
  );
  it.each(['id', 'userId', 'targetUserId', 'username', 'updatedBy', 'roles'])(
    'rejects body %s before any account can be changed',
    async (key) => {
      const result = await request(server)
        .patch('/api/auth/me/profile')
        .send({ nickname: 'Changed', [key]: 'other-user' })
        .expect(400);
      expect(result.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(update).not.toHaveBeenCalled();
    },
  );
  it('also rejects identifiers in direct service calls, even the actor ID', async () => {
    await expect(
      auth.updateProfile(self, { nickname: 'Changed', id: self.id } as {
        nickname: string;
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });
  it('requires authentication', async () => {
    actor = undefined;
    await request(server)
      .patch('/api/auth/me/profile')
      .send({ nickname: 'Changed' })
      .expect(401);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects a disabled/deleted actor rather than reporting success', async () => {
    update.mockResolvedValueOnce({ affected: 0 });
    await request(server)
      .patch('/api/auth/me/profile')
      .send({ nickname: 'Changed' })
      .expect(401);
  });
});
