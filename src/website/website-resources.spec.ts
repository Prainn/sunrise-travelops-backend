import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { ResponseInterceptor } from '../common/interceptors/response.interceptor';
import { createValidationException } from '../common/validation/validation-exception.factory';
import { WebsiteController } from './website.controller';
import { WebsiteResourceQuery } from './website.dto';
import { WebsiteService } from './website.service';
import type { ResourceDetail } from './website.service';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: createValidationException,
});
const actor: AuthenticatedUser = {
  id: 'test-user',
  username: 'tester',
  nickname: '',
  identityId: 'test-identity',
  scope: 'website',
  scopeName: '',
  deptId: null,
  deptName: '',
  roles: [],
  menuKeys: [],
  permissions: ['website:config:list'],
};

async function query(input: Record<string, unknown>) {
  return (await pipe.transform(input, {
    type: 'query',
    metatype: WebsiteResourceQuery,
  })) as WebsiteResourceQuery;
}

function setup(total = '0', rows: unknown[] = []) {
  const execute = jest
    .fn<Promise<unknown[]>, [string, unknown[]]>()
    .mockResolvedValueOnce([{ total }])
    .mockResolvedValueOnce(rows);
  const service = new WebsiteService({
    manager: { query: execute },
  } as unknown as DataSource);
  return { service, execute };
}

describe('website public resource city filtering', () => {
  it.each([
    ['hotel', 'resource_hotels', 'city'],
    ['restaurant', 'resource_restaurants', 'city'],
    ['attraction', 'resource_attractions', 'area'],
  ])(
    'combines city and keyword before counting and paginating %s',
    async (kind, table, column) => {
      const rows = [
        { id: 'matching-resource', name: '测试资源', city: '昆明' },
      ];
      const { service, execute } = setup('3', rows);
      const result = await service.resources(
        kind,
        await query({
          city: ' 昆明 ',
          keyword: '测试',
          page: '2',
          pageSize: '2',
        }),
        actor,
      );
      const where = ` WHERE deleted_at IS NULL AND status='enabled' AND (name ILIKE $1 OR code ILIKE $1) AND ${column} = $2`;
      expect(execute).toHaveBeenNthCalledWith(
        1,
        `SELECT count(*)::text AS total FROM ${table}${where}`,
        ['%测试%', '昆明'],
      );
      expect(execute).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(`FROM ${table}${where} ORDER BY name,id`),
        ['%测试%', '昆明', 2, 2],
      );
      expect(execute.mock.calls[1][0]).toContain('LIMIT $3 OFFSET $4');
      expect(result).toEqual({ list: rows, total: 3, page: 2, pageSize: 2 });
    },
  );

  it('binds city as a literal parameter and returns empty results without fallback', async () => {
    const city = "昆明' OR 1=1 --%";
    const { service, execute } = setup();
    const result = await service.resources(
      'hotel',
      await query({ city }),
      actor,
    );
    expect(execute.mock.calls[0][0]).toContain('AND city = $1');
    expect(execute.mock.calls[0][0]).not.toContain(city);
    expect(execute.mock.calls[0][1]).toEqual([city]);
    expect(execute.mock.calls[1][0]).toContain('LIMIT $2 OFFSET $3');
    expect(execute.mock.calls[1][1]).toEqual([city, 20, 0]);
    expect(result).toEqual({ list: [], total: 0, page: 1, pageSize: 20 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, '', '   '])(
    'keeps the unfiltered request when city is %p',
    async (city) => {
      const { service, execute } = setup();
      await service.resources('hotel', await query({ city }), actor);
      expect(execute.mock.calls[0][0]).not.toContain('AND city');
      expect(execute.mock.calls[0][1]).toEqual([]);
      expect(execute.mock.calls[1][0]).toContain('LIMIT $1 OFFSET $2');
      expect(execute.mock.calls[1][1]).toEqual([20, 0]);
    },
  );

  it.each(['city', 'transport'])(
    'rejects a nonempty city filter for %s before querying',
    async (kind) => {
      const { service, execute } = setup();
      await expect(
        service.resources(kind, await query({ city: '昆明' }), actor),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    { city: ['昆明', '大理'] },
    { city: { name: '昆明' } },
    { city: 42 },
    { city: '城'.repeat(101) },
    { cityId: 'unmapped-city-id' },
    { businessUnit: 'website' },
    { page: '0' },
    { pageSize: '101' },
  ])('rejects invalid query %p', async (input) => {
    await expect(query(input)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it.each([
    { ...actor, permissions: [] },
    { ...actor, scope: 'shengxu' as const },
  ])('keeps the access boundary for %p', async (user) => {
    const { service, execute } = setup();
    await expect(
      service.resources('hotel', await query({ city: '昆明' }), user),
    ).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    expect(execute).not.toHaveBeenCalled();
  });
});

// In-memory HTTP app with a mocked database; never connects to a business database.
describe('website public resource detail', () => {
  const id = 'b6201fe4-dceb-47f9-a5eb-7e379963b85f';
  let app: INestApplication<Server>;
  let user = actor;
  const execute = jest.fn<Promise<unknown[]>, [string, unknown[]]>();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [WebsiteController],
      providers: [
        WebsiteService,
        { provide: DataSource, useValue: { manager: { query: execute } } },
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('api');
    app.use(
      (req: { user: AuthenticatedUser }, _res: unknown, next: () => void) => {
        req.user = user;
        next();
      },
    );
    app.useGlobalGuards(new PermissionsGuard(module.get(Reflector)));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor(module.get(Reflector)));
    await app.init();
  });
  beforeEach(() => {
    user = actor;
    execute.mockReset();
    execute.mockResolvedValue([]);
  });
  afterAll(async () => app?.close());

  it.each([
    ['restaurant', 'resource_restaurants', ',city', { city: '大理' }],
    ['city', 'resource_cities', '', {}],
    ['hotel', 'resource_hotels', ',city', { city: '大理' }],
    ['attraction', 'resource_attractions', ',area AS city', { city: '大理' }],
    ['transport', 'resource_transports', ',seats', { seats: 7 }],
  ])(
    'reads %s by ID without relying on a historical name or page',
    async (kind, table, extra, fields) => {
      const row = {
        id,
        name: '改名后的公共资源',
        status: 'enabled',
        ...fields,
      };
      execute.mockResolvedValue([row]);
      const response = await request(app.getHttpServer())
        .get(`/api/website/resources/${kind}/${id}`)
        .expect(200);
      expect(response.body).toMatchObject({ code: 'SUCCESS', data: row });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith(
        `SELECT id,name,status${extra} FROM ${table} WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      );
    },
  );

  it.each(['website', 'linxi', 'headquarters'] as const)(
    'allows %s to read a disabled historical reference without enabling it',
    async (scope) => {
      user = { ...actor, scope };
      const row = { id, name: '停用餐厅', city: '大理', status: 'disabled' };
      execute.mockResolvedValue([row]);
      const response = await request(app.getHttpServer())
        .get(`/api/website/resources/restaurant/${id}`)
        .expect(200);
      expect((response.body as { data: ResourceDetail }).data).toEqual(row);
      expect(execute.mock.calls[0][0]).not.toContain("status='enabled'");
    },
  );

  it('returns 404 when no nondeleted record exists, without a name fallback', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/website/resources/restaurant/${id}`)
      .expect(404);
    expect((response.body as { code: string }).code).toBe('NOT_FOUND');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('preserves an unknown city instead of fabricating a match', async () => {
    execute.mockResolvedValue([
      { id, name: '餐厅', city: null, status: 'enabled' },
    ]);
    const response = await request(app.getHttpServer())
      .get(`/api/website/resources/restaurant/${id}`)
      .expect(200);
    expect((response.body as { data: ResourceDetail }).data.city).toBeNull();
  });

  it.each([
    ['restaurant', 'not-a-uuid'],
    ['unknown', id],
    ['constructor', id],
    ['__proto__', id],
  ])(
    'rejects invalid kind/ID %s/%s before querying',
    async (kind, resourceId) => {
      const response = await request(app.getHttpServer())
        .get(`/api/website/resources/${kind}/${resourceId}`)
        .expect(400);
      expect((response.body as { code: string }).code).toBe('BAD_REQUEST');
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...actor, permissions: [] },
    { ...actor, scope: 'shengxu' as const },
  ])(
    'denies inaccessible actors before looking up an ID',
    async (deniedActor) => {
      user = deniedActor;
      const response = await request(app.getHttpServer())
        .get(`/api/website/resources/restaurant/${id}`)
        .expect(403);
      expect((response.body as { code: string }).code).toBe('AUTH_FORBIDDEN');
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
