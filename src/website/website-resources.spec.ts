import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types';
import { createValidationException } from '../common/validation/validation-exception.factory';
import { WebsiteResourceQuery } from './website.dto';
import { WebsiteService } from './website.service';

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
