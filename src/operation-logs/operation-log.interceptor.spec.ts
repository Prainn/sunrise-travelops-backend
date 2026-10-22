import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Logger,
  StreamableFile,
} from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { validateSync } from 'class-validator';
import { firstValueFrom, of, throwError } from 'rxjs';
import { OperationLogInterceptor } from './operation-log.interceptor';
import { OperationEntry, OperationLogsService } from './operation-logs.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/constants/error-code';
import { OperationLogQueryDto } from './operation-logs.controller';

// Discover real routes so a new background write endpoint cannot silently skip audit.
function operationRoutes(): [string, string][] {
  const root = join(__dirname, '..');
  const routes: [string, string][] = [];
  for (const file of readdirSync(root, { recursive: true })) {
    if (typeof file !== 'string' || !file.endsWith('.controller.ts')) continue;
    const source = ts.createSourceFile(
      file,
      readFileSync(join(root, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of source.statements) {
      if (!ts.isClassDeclaration(statement) || !statement.name) continue;
      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const handler = member.name.getText(source);
        const decorators = ts.getDecorators(member) ?? [];
        if (
          decorators.some((decorator) => {
            const expression = decorator.expression;
            if (!ts.isCallExpression(expression)) return false;
            const verb = expression.expression.getText(source);
            return (
              ['Post', 'Put', 'Patch', 'Delete'].includes(verb) ||
              (verb === 'Get' && handler === 'export')
            );
          })
        )
          routes.push([statement.name.text, handler]);
      }
    }
  }
  return routes;
}

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

  it('covers every current backend mutation and export except technical/public collection endpoints', async () => {
    const excluded = new Set([
      'AuthController.refresh', // Token renewal is not a user operation.
      'LynxController.register', // Public attribution collection, not an internal page.
    ]);
    const missing: string[] = [];
    for (const [controller, handler] of operationRoutes()) {
      if (excluded.has(`${controller}.${handler}`)) continue;
      const before = entries.length;
      await firstValueFrom(
        interceptor.intercept(
          context(controller, handler, {
            user: actor,
            params: { id: 'target-id' },
            query: { ids: 'target-id' },
            body: {},
          }),
          { handle: () => of({ id: 'result-id' }) },
        ),
      );
      if (entries.length === before) missing.push(`${controller}.${handler}`);
    }
    expect(missing).toEqual([]);
  });

  it.each([
    ['ShengxuLedgersController', 'create', '新增盛旭台账'],
    ['ShengxuLedgersController', 'update', '编辑盛旭台账'],
    ['ShengxuLedgersController', 'delete', '删除盛旭台账'],
    ['DirectLedgersController', 'create', '新增霖熹/独立站台账'],
    ['DirectLedgersController', 'update', '编辑霖熹/独立站台账'],
    ['DirectLedgersController', 'delete', '删除霖熹/独立站台账'],
    ['DirectLedgersController', 'review', '审核霖熹/独立站台账'],
    ['DirectLedgersController', 'operate', '保存霖熹/独立站台账操作信息'],
  ])(
    'records successful and failed %s.%s with its target',
    async (controller, handler, action) => {
      const request = {
        user: { ...actor, scope: 'linxi' },
        params: handler === 'create' ? {} : { id: 'ledger-id' },
        query: {},
        body: { contact: 'private-contact', amount: 'private-amount' },
      };
      await firstValueFrom(
        interceptor.intercept(context(controller, handler, request), {
          handle: () =>
            of(handler === 'delete' ? undefined : { id: 'ledger-id' }),
        }),
      );
      const failure = new BusinessException({
        code: ErrorCode.CONFLICT,
        status: HttpStatus.CONFLICT,
        message: 'private-error',
      });
      await expect(
        firstValueFrom(
          interceptor.intercept(context(controller, handler, request), {
            handle: () => throwError(() => failure),
          }),
        ),
      ).rejects.toBe(failure);
      expect(entries).toMatchObject([
        { category: 'ledger', action, success: true, scope: 'linxi' },
        { category: 'ledger', action, success: false, scope: 'linxi' },
      ]);
      expect(JSON.parse(entries[0].detail)).toEqual({ recordId: 'ledger-id' });
      expect(JSON.parse(entries[1].detail)).toEqual({
        ...(handler === 'create' ? {} : { recordId: 'ledger-id' }),
        statusCode: 409,
        errorCode: ErrorCode.CONFLICT,
      });
      expect(JSON.stringify(entries)).not.toContain('private-');
    },
  );

  it('records a conversion once with the new inquiry and source visit, including failed source', async () => {
    const request = {
      user: actor,
      params: { id: 'visit-id' },
      query: {},
      body: { contact: 'private-contact' },
    };
    const result = { id: 'inquiry-id', customer: 'private-customer' };
    const value = await firstValueFrom(
      interceptor.intercept(
        context('WebsiteVisitsController', 'create', request),
        {
          handle: () => of(result),
        },
      ),
    );
    expect(value).toBe(result);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      category: 'website-visit',
      success: true,
    });
    expect(JSON.parse(entries[0].detail)).toEqual({
      recordId: 'inquiry-id',
      parentId: 'visit-id',
    });
    const failure = new Error('private-error');
    await expect(
      firstValueFrom(
        interceptor.intercept(
          context('WebsiteVisitsController', 'create', request),
          {
            handle: () => throwError(() => failure),
          },
        ),
      ),
    ).rejects.toBe(failure);
    expect(JSON.parse(entries[1].detail)).toEqual({
      parentId: 'visit-id',
      statusCode: 500,
    });
    expect(JSON.stringify(entries)).not.toContain('private-');
  });

  it('records export stream initiation and pre-stream failure without copying CSV or query data', async () => {
    const request = {
      user: actor,
      params: {},
      query: { keyword: 'private-keyword' },
      body: {},
    };
    const file = new StreamableFile(Buffer.from('private-csv'));
    const value = await firstValueFrom(
      interceptor.intercept(
        context('WebsiteVisitsController', 'export', request),
        {
          handle: () => of(file),
        },
      ),
    );
    expect(value).toBe(file);
    const failure = new Error('private-error');
    await expect(
      firstValueFrom(
        interceptor.intercept(
          context('WebsiteVisitsController', 'export', request),
          {
            handle: () => throwError(() => failure),
          },
        ),
      ),
    ).rejects.toBe(failure);
    expect(entries).toMatchObject([
      { category: 'website-visit', success: true, detail: '{}' },
      {
        category: 'website-visit',
        success: false,
        detail: '{"statusCode":500}',
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain('private-');
  });

  it.each(['ledger', 'website-visit'])(
    'accepts the %s category with a business filter',
    (category) => {
      const query = Object.assign(new OperationLogQueryDto(), {
        category,
        scope: 'website',
        page: 1,
        pageSize: 20,
      });
      expect(validateSync(query)).toEqual([]);
      query.category = 'unknown' as typeof query.category;
      expect(validateSync(query).map((error) => error.property)).toContain(
        'category',
      );
    },
  );

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
      ['LynxController', 'register'],
      ['ShengxuLedgersController', 'list'],
      ['DirectLedgersController', 'get'],
      ['WebsiteVisitsController', 'draft'],
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
