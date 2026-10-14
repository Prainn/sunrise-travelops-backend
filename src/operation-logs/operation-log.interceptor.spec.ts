import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { OperationLogInterceptor } from './operation-log.interceptor';
import { OperationEntry, OperationLogsService } from './operation-logs.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/constants/error-code';

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

  it('records a failed mutation without storing its body or error message and rethrows the same error', async () => {
    const request = {
      user: actor,
      body: {
        identityNumber: 'private-document',
        password: 'private-password',
      },
      params: { id: 'resource-id' },
      query: {},
      ip: '127.0.0.1',
    };
    const failure = new BusinessException({
      code: ErrorCode.RESOURCE_VERSION_CONFLICT,
      status: HttpStatus.CONFLICT,
      message: 'private-error-message',
      details: { identityNumber: 'private-document' },
    });
    await expect(
      firstValueFrom(
        interceptor.intercept(context('GuidesController', 'update', request), {
          handle: () => throwError(() => failure),
        } as CallHandler),
      ),
    ).rejects.toBe(failure);
    expect(entries).toMatchObject([{ category: 'resource', success: false }]);
    expect(JSON.parse(entries[0].detail)).toEqual({
      recordId: 'resource-id',
      statusCode: 409,
      errorCode: ErrorCode.RESOURCE_VERSION_CONFLICT,
    });
    expect(JSON.stringify(entries)).not.toContain('private-');
  });

  it.each([
    ['InquiriesController', 'createPlan', 'itinerary', '新增行程'],
    ['ItinerariesController', 'copy', 'itinerary', '复制行程'],
    ['WebsiteController', 'createItinerary', 'itinerary', '新增独立站行程'],
    ['WebsiteController', 'copy', 'itinerary', '复制独立站行程'],
  ])(
    'records the new object and source for %s.%s',
    async (controller, handler, category, action) => {
      const result = { id: 'new-itinerary', title: 'private-title' };
      const request = {
        user: actor,
        body: { version: 1 },
        params: { id: 'source-id' },
        query: {},
      };
      const value = await firstValueFrom(
        interceptor.intercept(context(controller, handler, request), {
          handle: () => of(result),
        } as CallHandler),
      );
      expect(value).toBe(result);
      expect(entries).toMatchObject([{ category, action, success: true }]);
      expect(JSON.parse(entries[0].detail)).toEqual({
        recordId: 'new-itinerary',
        parentId: 'source-id',
      });
      expect(JSON.stringify(entries)).not.toContain('private-title');
    },
  );

  it.each([
    ['InquiriesController', 'transfer', 'inquiry'],
    ['InquiriesController', 'archive', 'inquiry'],
    ['ItinerariesController', 'confirm', 'quotation'],
    ['ItinerariesController', 'previewQuote', 'quotation'],
    ['ItinerariesController', 'downloadClick', 'quotation'],
    ['WebsiteController', 'generate', 'itinerary'],
    ['WebsiteController', 'saveConfig', 'website-config'],
    ['ToursController', 'cancel', 'tour'],
    ['ToursController', 'saveRating', 'guide-rating'],
    ['GuideLeavesController', 'update', 'guide-leave'],
  ])(
    'logs %s.%s without serializing business data',
    async (controller, handler, category) => {
      const result = { quotation: { customer: 'private-customer' } };
      const request = {
        user: actor,
        params: { id: 'object-id' },
        query: {},
        body: { comment: 'private-comment' },
      };
      await firstValueFrom(
        interceptor.intercept(context(controller, handler, request), {
          handle: () => of(result),
        } as CallHandler),
      );
      expect(entries).toMatchObject([{ category, success: true }]);
      expect(JSON.parse(entries[0].detail)).toEqual({ recordId: 'object-id' });
      expect(JSON.stringify(entries)).not.toContain('private-');
    },
  );

  it('logs each failed batch-delete target and preserves the failure', async () => {
    const failure = new Error('rejected');
    const request = {
      user: actor,
      params: {},
      query: { ids: ['leave-1', 'leave-2'] },
      body: {},
    };
    await expect(
      firstValueFrom(
        interceptor.intercept(
          context('GuideLeavesController', 'delete', request),
          {
            handle: () => throwError(() => failure),
          } as CallHandler,
        ),
      ),
    ).rejects.toBe(failure);
    expect(
      entries.map((entry) => {
        const detail = JSON.parse(entry.detail) as { recordId: string };
        return [entry.success, detail.recordId];
      }),
    ).toEqual([
      [false, 'leave-1'],
      [false, 'leave-2'],
    ]);
  });

  it('leaves ordinary reads and token refresh unlogged', async () => {
    const request = {
      user: actor,
      params: { id: 'object-id' },
      query: {},
      body: {},
    };
    for (const [controller, handler] of [
      ['ItinerariesController', 'detail'],
      ['WebsiteController', 'quotation'],
      ['ToursController', 'list'],
      ['AuthController', 'refresh'],
    ]) {
      await firstValueFrom(
        interceptor.intercept(context(controller, handler, request), {
          handle: () => of({}),
        } as CallHandler),
      );
    }
    expect(entries).toEqual([]);
  });

  it('preserves a successful response when log persistence fails', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    logs.append.mockRejectedValueOnce(new Error('log storage unavailable'));
    const result = { id: 'inquiry-id' };
    try {
      const value = await firstValueFrom(
        interceptor.intercept(
          context('InquiriesController', 'create', {
            user: actor,
            params: {},
            query: {},
            body: {},
          }),
          { handle: () => of(result) } as CallHandler,
        ),
      );
      expect(value).toBe(result);
      expect(logger).toHaveBeenCalled();
    } finally {
      logger.mockRestore();
    }
  });
});
