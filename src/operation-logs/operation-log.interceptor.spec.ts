import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { OperationLogInterceptor } from './operation-log.interceptor';
import { OperationEntry, OperationLogsService } from './operation-logs.service';

function context(
  controller: string,
  handler: string,
  request: Record<string, unknown>,
): ExecutionContext {
  return {
    getClass: () => ({ name: controller }),
    getHandler: () => ({ name: handler }),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('OperationLogInterceptor', () => {
  const entries: OperationEntry[] = [];
  const logs = {
    append: jest.fn((rows: OperationEntry[]) => {
      entries.push(...rows);
      return Promise.resolve();
    }),
  };
  const interceptor = new OperationLogInterceptor(
    logs as unknown as OperationLogsService,
  );
  const actor = { id: 'actor-id', username: 'sunrise', scope: 'headquarters' };

  beforeEach(() => {
    entries.length = 0;
    logs.append.mockClear();
  });

  it('records each deleted resource ID and its parent ID', async () => {
    const request = {
      user: actor,
      body: {},
      params: { restaurantId: 'parent-id' },
      query: { ids: 'price-1,price-2' },
      ip: '127.0.0.1',
    };
    await firstValueFrom(
      interceptor.intercept(
        context('RestaurantsController', 'deletePrices', request),
        { handle: () => of(undefined) } as CallHandler,
      ),
    );
    expect(entries.map((entry) => [entry.action, entry.detail])).toEqual([
      ['删除餐厅价格', '{"recordId":"price-1","parentId":"parent-id"}'],
      ['删除餐厅价格', '{"recordId":"price-2","parentId":"parent-id"}'],
    ]);
  });

  it('records a failed login without storing request passwords', async () => {
    const request = {
      body: { username: 'sunrise', password: 'secret', scope: 'headquarters' },
      params: {},
      query: {},
      ip: '127.0.0.1',
    };
    await expect(
      firstValueFrom(
        interceptor.intercept(context('AuthController', 'login', request), {
          handle: () => throwError(() => new Error('invalid')),
        } as CallHandler),
      ),
    ).rejects.toThrow('invalid');
    expect(entries).toMatchObject([
      {
        category: 'login',
        action: '登录',
        success: false,
        actorName: 'sunrise',
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain('secret');
  });

  it('does not record failed business mutations', async () => {
    const request = {
      user: actor,
      body: {},
      params: { id: 'resource-id' },
      query: {},
      ip: '127.0.0.1',
    };
    await expect(
      firstValueFrom(
        interceptor.intercept(context('GuidesController', 'update', request), {
          handle: () => throwError(() => new Error('conflict')),
        } as CallHandler),
      ),
    ).rejects.toThrow('conflict');
    expect(entries).toEqual([]);
  });
});
