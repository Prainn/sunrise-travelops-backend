import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { AgenciesController } from '../resources/agencies/agencies.controller';
import { AgenciesService } from '../resources/agencies/agencies.service';
import { SelectionController } from '../resources/selections/selection.controller';
import { SelectionService } from '../resources/selections/selection.service';
import { allowedMenuKeys } from '../roles/menu-definitions';
import { LoginScope } from '../users/user-identity.entity';
import { AuthenticatedUser } from './auth.types';
import { PermissionsGuard } from './guards/permissions.guard';
import { effectivePermissions } from './identity-permissions';

// Exercise actual controllers and permission guards with no database or business API.
describe('agency resource business access', () => {
  let app: INestApplication;
  let server: Server;
  let actor: AuthenticatedUser;
  const readAgency = jest.fn().mockResolvedValue([]);
  const readOptions = jest.fn().mockResolvedValue([]);
  const id = '00000000-0000-4000-8000-000000000001';
  const base = '/api/resources/agencies';
  const businessRoles = ['BUSINESS_MANAGER', 'COORDINATOR', 'RESOURCE_MANAGER'];

  function setActor(scope: LoginScope, role: string) {
    actor = {
      id,
      username: 'actor',
      nickname: 'Actor',
      identityId: id,
      scope,
      scopeName: '',
      deptId: null,
      deptName: '',
      roles: [role],
      permissions: effectivePermissions(scope, [role], 'both'),
      menuKeys: ['agency'],
    };
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AgenciesController, SelectionController],
      providers: [
        { provide: AgenciesService, useValue: { list: readAgency } },
        { provide: SelectionService, useValue: { resources: readOptions } },
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
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it.each(
    (['linxi', 'website'] as const).flatMap((scope) =>
      businessRoles.map((role) => ({ scope, role })),
    ),
  )(
    '$scope/$role cannot access agency resources despite a stale menu grant',
    async ({ scope, role }) => {
      setActor(scope, role);
      expect(
        actor.permissions.filter((p) => p.startsWith('resource:agency:')),
      ).toEqual([]);
      expect(allowedMenuKeys(scope, [role])).not.toContain('agency');
      const endpoints = [
        ['get', base],
        ['get', `${base}/${id}`],
        ['get', `${base}/coordinators?businessUnit=shengxu`],
        ['get', `${base}/${id}/contacts`],
        ['get', '/api/resources/selections/agencies'],
        ['post', base],
        ['put', `${base}/${id}`],
        ['delete', `${base}?ids=${id}`],
        ['post', `${base}/${id}/contacts`],
        ['put', `${base}/${id}/contacts/${id}`],
        ['delete', `${base}/${id}/contacts?ids=${id}`],
      ] as const;
      for (const [method, path] of endpoints) {
        const response = await request(server)[method](path).send({});
        const body = response.body as { code: string };
        expect({
          method,
          path,
          status: response.status,
          code: body.code,
        }).toEqual({
          method,
          path,
          status: 403,
          code: 'AUTH_FORBIDDEN',
        });
      }
      expect(readAgency).not.toHaveBeenCalled();
      expect(readOptions).not.toHaveBeenCalled();
      await request(server).get('/api/resources/selections/hotels').expect(200);
      expect(readOptions).toHaveBeenCalledWith('hotels', expect.anything());
    },
  );

  it.each([
    ...['ROOT', 'ADMIN', 'EXECUTIVE'].map((role) => ({
      scope: 'headquarters' as const,
      role,
    })),
    ...businessRoles.map((role) => ({ scope: 'shengxu' as const, role })),
  ])('$scope/$role retains agency read access', async ({ scope, role }) => {
    setActor(scope, role);
    expect(allowedMenuKeys(scope, [role])).toContain('agency');
    await request(server).get(base).expect(200);
    await request(server).get('/api/resources/selections/agencies').expect(200);
    expect(readAgency).toHaveBeenCalledTimes(1);
    expect(readOptions).toHaveBeenCalledWith('agencies', expect.anything());
  });
});
