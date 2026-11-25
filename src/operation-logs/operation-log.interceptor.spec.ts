import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
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
            return [
              'Get',
              'Post',
              'Put',
              'Patch',
              'Delete',
              'Head',
              'Options',
              'All',
              'Sse',
            ].includes(verb);
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
  const actor = {
    id: 'b1faa09c-3773-5e00-be0e-30151cd7fa13',
    username: 'sunrise',
    scope: 'headquarters',
  };

  beforeEach(() => {
    entries.length = 0;
    logs.append.mockClear();
  });

  it('records every registered HTTP endpoint once except successes written directly by the owner', async () => {
    const excluded = new Set([
      'OperationLogsController.clientEvent',
      'AuthController.switchAccount',
      'AccountLinksController.create',
      'AccountLinksController.update',
      'AccountLinksController.delete',
    ]);
    const missing: string[] = [];
    for (const [controller, handler] of operationRoutes()) {
      if (excluded.has(`${controller}.${handler}`)) continue;
      const before = entries.length;
      await firstValueFrom(
        interceptor.intercept(
          context(controller, handler, {
            user: actor,
            params: { id: 'c814ce1a-1158-5655-a718-6cfced8dd96b' },
            query: { ids: 'c814ce1a-1158-5655-a718-6cfced8dd96b' },
            body: {},
          }),
          { handle: () => of({ id: '66b58007-9b79-5f8d-afb4-d59693a183c1' }) },
        ),
      );
      if (
        entries.length !== before + 1 ||
        !entries[before].actorName ||
        !entries[before].scope ||
        !Object.keys(
          JSON.parse(entries[before].detail) as Record<string, unknown>,
        ).length
      )
        missing.push(`${controller}.${handler}`);
    }
    expect(missing).toEqual([]);
  });

  it.each(['list', 'export', 'row'])(
    'identifies the service for machine visit source %s',
    async (handler) => {
      await firstValueFrom(
        interceptor.intercept(
          context('WebsiteVisitsApiController', handler, {
            params: {},
            query: {},
          }),
          { handle: () => of({}) },
        ),
      );
      expect(entries[0]).toMatchObject({
        actorName: '访问记录服务',
        scope: 'website',
      });
    },
  );

  it.each([
    ['InquiriesController', '删除询盘'],
    ['WebsiteController', '删除独立站询盘'],
  ])(
    'records %s deletion after a 204 response and captures rejected versions',
    async (controller, action) => {
      const request = {
        user: actor,
        params: { id: 'aa321860-25da-5d9f-831f-de9b3cf8c185' },
        body: { version: 2 },
        query: {},
      };
      await firstValueFrom(
        interceptor.intercept(context(controller, 'delete', request), {
          handle: () => of(undefined),
        }),
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        category: 'inquiry',
        action,
        success: true,
        detail: JSON.stringify({
          recordId: 'aa321860-25da-5d9f-831f-de9b3cf8c185',
        }),
      });
      const failure = new BusinessException({
        code: ErrorCode.INQUIRY_VERSION_CONFLICT,
        message: 'Conflict',
        status: HttpStatus.CONFLICT,
      });
      await expect(
        firstValueFrom(
          interceptor.intercept(context(controller, 'delete', request), {
            handle: () => throwError(() => failure),
          }),
        ),
      ).rejects.toBe(failure);
      expect(entries[1]).toMatchObject({
        category: 'inquiry',
        action,
        success: false,
      });
    },
  );

  it('records service segment pointers and the composite rating target without request payloads', async () => {
    const change = {
      serviceIds: ['segment-a'],
      guideIds: ['fa399b9a-929a-5c74-b15e-88dfe7c08e23'],
      removedServiceIds: ['segment-b'],
      removedGuideIds: ['guide-b'],
    };
    await firstValueFrom(
      interceptor.intercept(
        context('ToursController', 'update', {
          user: actor,
          params: { id: '04c340a2-a001-58a0-a342-300950553793' },
          body: { remark: 'private' },
          tourGuideServiceChange: change,
        }),
        { handle: () => of({ id: '04c340a2-a001-58a0-a342-300950553793' }) },
      ),
    );
    expect(JSON.parse(entries[0].detail)).toEqual({
      recordId: '04c340a2-a001-58a0-a342-300950553793',
      ...change,
    });
    await firstValueFrom(
      interceptor.intercept(
        context('ToursController', 'saveRating', {
          user: actor,
          params: {
            id: '04c340a2-a001-58a0-a342-300950553793',
            guideId: 'fa399b9a-929a-5c74-b15e-88dfe7c08e23',
          },
          body: { selfScore: 50 },
        }),
        {
          handle: () =>
            of({
              tourId: '04c340a2-a001-58a0-a342-300950553793',
              guideId: 'fa399b9a-929a-5c74-b15e-88dfe7c08e23',
            }),
        },
      ),
    );
    expect(JSON.parse(entries[1].detail)).toEqual({
      recordId: '04c340a2-a001-58a0-a342-300950553793',
      guideId: 'fa399b9a-929a-5c74-b15e-88dfe7c08e23',
    });
    expect(JSON.stringify(entries)).not.toContain('private');
  });

  it.each([
    ['ToursController', 'availableGuides'],
    ['WebsiteController', 'validateItinerary'],
  ])(
    'audits read-only POST %s.%s, including failures',
    async (controller, handler) => {
      const request = { user: actor, params: {}, body: {} };
      await firstValueFrom(
        interceptor.intercept(context(controller, handler, request), {
          handle: () => of([]),
        }),
      );
      const failure = new Error('validation failed');
      await expect(
        firstValueFrom(
          interceptor.intercept(context(controller, handler, request), {
            handle: () => throwError(() => failure),
          }),
        ),
      ).rejects.toBe(failure);
      expect(entries.map((row) => row.success)).toEqual([true, false]);
    },
  );

  it.each([
    ['ShengxuLedgersController', 'create', '新增盛旭台账'],
    ['ShengxuLedgersController', 'update', '编辑盛旭台账'],
    ['ShengxuLedgersController', 'delete', '删除盛旭台账'],
    ['DirectLedgersController', 'create', '新增霖熹台账'],
    ['DirectLedgersController', 'update', '编辑霖熹台账'],
    ['DirectLedgersController', 'delete', '删除霖熹台账'],
    ['DirectLedgersController', 'review', '审核霖熹台账'],
    ['DirectLedgersController', 'operate', '保存霖熹台账操作信息'],
  ])(
    'records successful and failed %s.%s with its target',
    async (controller, handler, action) => {
      const request = {
        user: { ...actor, scope: 'linxi' },
        params:
          handler === 'create'
            ? {}
            : { id: 'ca750926-c850-554b-9ca0-4adcab6b2ed8' },
        query: {},
        body: { contact: 'private-contact', amount: 'private-amount' },
      };
      await firstValueFrom(
        interceptor.intercept(context(controller, handler, request), {
          handle: () =>
            of(
              handler === 'delete'
                ? undefined
                : { id: 'ca750926-c850-554b-9ca0-4adcab6b2ed8' },
            ),
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
      expect(JSON.parse(entries[0].detail)).toEqual({
        recordId: 'ca750926-c850-554b-9ca0-4adcab6b2ed8',
      });
      expect(JSON.parse(entries[1].detail)).toEqual({
        ...(handler === 'create'
          ? {}
          : { recordId: 'ca750926-c850-554b-9ca0-4adcab6b2ed8' }),
        statusCode: 409,
        errorCode: ErrorCode.CONFLICT,
      });
      expect(JSON.stringify(entries)).not.toContain('private-');
    },
  );

  it.each(['create', 'update', 'delete', 'review', 'operate'])(
    'distinguishes website %s from linxi without changing actor scope',
    async (handler) => {
      await firstValueFrom(
        interceptor.intercept(
          context('DirectLedgersController', handler, {
            user: { ...actor, scope: 'website' },
            params: { id: 'ca750926-c850-554b-9ca0-4adcab6b2ed8' },
            query: {},
            body: {},
          }),
          { handle: () => of(undefined) },
        ),
      );
      expect(entries[0].action).toContain('独立站台账');
      expect(entries[0].scope).toBe('website');
    },
  );

  it.each(['linxi', 'website'])(
    'labels headquarters delegated creation using target %s for success and failure',
    async (businessUnit) => {
      const request = {
        user: actor,
        params: {},
        query: {},
        body: { businessUnit },
      };
      await firstValueFrom(
        interceptor.intercept(
          context('DirectLedgersController', 'create', request),
          {
            handle: () =>
              of({ id: 'ca750926-c850-554b-9ca0-4adcab6b2ed8', businessUnit }),
          },
        ),
      );
      const failure = new Error('failed');
      await expect(
        firstValueFrom(
          interceptor.intercept(
            context('DirectLedgersController', 'create', request),
            { handle: () => throwError(() => failure) },
          ),
        ),
      ).rejects.toBe(failure);
      expect(
        entries.map(({ action, scope, success }) => ({
          action,
          scope,
          success,
        })),
      ).toEqual(
        [true, false].map((success) => ({
          action: businessUnit === 'linxi' ? '新增霖熹台账' : '新增独立站台账',
          scope: 'headquarters',
          success,
        })),
      );
    },
  );

  it('uses the returned ledger business and does not trust an update body to classify a rejected headquarters action', async () => {
    const request = {
      user: actor,
      params: { id: 'ca750926-c850-554b-9ca0-4adcab6b2ed8' },
      query: {},
      body: { businessUnit: 'linxi' },
    };
    await firstValueFrom(
      interceptor.intercept(
        context('DirectLedgersController', 'create', request),
        {
          handle: () =>
            of({
              id: 'ca750926-c850-554b-9ca0-4adcab6b2ed8',
              businessUnit: 'website',
            }),
        },
      ),
    );
    expect(entries[0].action).toBe('新增独立站台账');
    const failure = new Error('forbidden');
    await expect(
      firstValueFrom(
        interceptor.intercept(
          context('DirectLedgersController', 'update', request),
          { handle: () => throwError(() => failure) },
        ),
      ),
    ).rejects.toBe(failure);
    expect(entries[1]).toMatchObject({
      action: '编辑直客台账',
      scope: 'headquarters',
      success: false,
    });
  });

  it('records a conversion once with the new inquiry and source visit, including failed source', async () => {
    const request = {
      user: actor,
      params: { id: 'cddd6ae9-ab0e-594f-9c9a-d95402c0a72a' },
      query: {},
      body: { contact: 'private-contact' },
    };
    const result = {
      id: 'aa321860-25da-5d9f-831f-de9b3cf8c185',
      customer: 'private-customer',
    };
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
      recordId: 'aa321860-25da-5d9f-831f-de9b3cf8c185',
      parentId: 'cddd6ae9-ab0e-594f-9c9a-d95402c0a72a',
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
      parentId: 'cddd6ae9-ab0e-594f-9c9a-d95402c0a72a',
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
      {
        category: 'website-visit',
        success: true,
        detail: JSON.stringify({
          stage: 'stream_started',
          operation: 'WebsiteVisitsController.export',
        }),
      },
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
      params: { restaurantId: '65182725-0c03-52bd-8e62-f8e0274d124f' },
      query: {
        ids: '56d6533f-c396-53d3-bf91-f6853b47b9d7,3af3787e-92c9-5978-95a3-b70df213592a',
      },
      ip: '127.0.0.1',
    };
    await firstValueFrom(
      interceptor.intercept(
        context('RestaurantsController', 'deletePrices', request),
        { handle: () => of(undefined) } as CallHandler,
      ),
    );
    expect(entries.map((entry) => [entry.action, entry.detail])).toEqual([
      [
        '删除餐厅价格',
        '{"recordId":"56d6533f-c396-53d3-bf91-f6853b47b9d7","parentId":"65182725-0c03-52bd-8e62-f8e0274d124f"}',
      ],
      [
        '删除餐厅价格',
        '{"recordId":"3af3787e-92c9-5978-95a3-b70df213592a","parentId":"65182725-0c03-52bd-8e62-f8e0274d124f"}',
      ],
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
      params: { id: '8738df05-8013-5798-b8c3-95de6b21b8f7' },
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
      recordId: '8738df05-8013-5798-b8c3-95de6b21b8f7',
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
      const result = {
        id: '223328f4-3aa1-58ce-aeee-b43ab08bd585',
        title: 'private-title',
      };
      const request = {
        user: actor,
        body: { version: 1 },
        params: { id: '0680cf78-efce-52c0-a01c-09b451833155' },
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
        recordId: '223328f4-3aa1-58ce-aeee-b43ab08bd585',
        parentId: '0680cf78-efce-52c0-a01c-09b451833155',
      });
      expect(JSON.stringify(entries)).not.toContain('private-title');
    },
  );

  it.each([
    ['InquiriesController', 'addFollowUp', 'inquiry'],
    ['WhatsappQuickRepliesController', 'update', 'business-category'],
    ['WhatsappController', 'retryEvent', 'system-category'],
    ['InquiriesController', 'transfer', 'inquiry'],
    ['InquiriesController', 'archive', 'inquiry'],
    ['ItinerariesController', 'confirm', 'quotation'],
    ['ItinerariesController', 'previewQuote', 'quotation'],
    ['ItinerariesController', 'downloadClick', 'quotation'],
    ['WebsiteController', 'generate', 'itinerary'],
    ['WebsiteController', 'saveConfig', 'website-config'],
    ['WebsiteController', 'updateConfigRecord', 'website-config'],
    ['WebsiteController', 'deleteConfigRecord', 'website-config'],
    ['UserManagementController', 'testFeishu', 'user'],
    ['ToursController', 'cancel', 'tour'],
    ['ToursController', 'saveRating', 'guide-rating'],
    ['GuideLeavesController', 'update', 'guide-leave'],
  ])(
    'logs %s.%s without serializing business data',
    async (controller, handler, category) => {
      const result =
        handler === 'createConfigRecord'
          ? {
              id: '3934eb38-e923-5ec5-b5d3-6267e7dd4775',
              group: 'hotels',
              version: 2,
            }
          : { quotation: { customer: 'private-customer' } };
      const request = {
        user: actor,
        params:
          handler === 'createConfigRecord'
            ? { group: 'hotels' }
            : { id: '3934eb38-e923-5ec5-b5d3-6267e7dd4775' },
        query: {},
        body: { comment: 'private-comment' },
      };
      await firstValueFrom(
        interceptor.intercept(context(controller, handler, request), {
          handle: () => of(result),
        } as CallHandler),
      );
      expect(entries).toMatchObject([{ category, success: true }]);
      expect(JSON.parse(entries[0].detail)).toEqual(
        handler === 'downloadClick'
          ? {
              recordId: '3934eb38-e923-5ec5-b5d3-6267e7dd4775',
              stage: 'download_requested',
            }
          : { recordId: '3934eb38-e923-5ec5-b5d3-6267e7dd4775' },
      );
      expect(JSON.stringify(entries)).not.toContain('private-');
    },
  );

  it('logs the created website resource ID and group without business data', async () => {
    const request = {
      user: actor,
      params: { group: 'routes' },
      query: {},
      body: { name: 'private-name' },
    };
    await firstValueFrom(
      interceptor.intercept(
        context('WebsiteController', 'createConfigRecord', request),
        {
          handle: () =>
            of({
              id: '8a161131-b8aa-5895-ae24-a35fab30bddd',
              version: 2,
              group: 'routes',
            }),
        } as CallHandler,
      ),
    );
    expect(entries).toMatchObject([
      { category: 'website-config', success: true },
    ]);
    expect(JSON.parse(entries[0].detail)).toEqual({
      recordId: '8a161131-b8aa-5895-ae24-a35fab30bddd',
      group: 'routes',
    });
    expect(JSON.stringify(entries)).not.toContain('private-name');
  });

  it('logs each failed batch-delete target and preserves the failure', async () => {
    const failure = new Error('rejected');
    const request = {
      user: actor,
      params: {},
      query: {
        ids: [
          '54ea1f3a-1ff0-58d8-8d4f-599fc272846b',
          '0595bcce-f971-5f69-8994-85831a6a1964',
        ],
      },
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
      [false, '54ea1f3a-1ff0-58d8-8d4f-599fc272846b'],
      [false, '0595bcce-f971-5f69-8994-85831a6a1964'],
    ]);
  });

  it('records ordinary reads, attribution and token refresh', async () => {
    const request = {
      user: actor,
      params: { id: '3934eb38-e923-5ec5-b5d3-6267e7dd4775' },
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
    expect(entries).toHaveLength(8);
    expect(entries.every((row) => row.result === 'success')).toBe(true);
  });

  it.each([
    [['queued', 'accepted'], 'pending'],
    [['sent', 'delivered'], 'success'],
    [['sent', 'failed'], 'failure'],
    [['unknown', 'queued'], 'unknown'],
  ] as const)(
    'records the returned status of an idempotent WhatsApp submission %j',
    async (states, outcome) => {
      const response = {
        messages: states.map((status) => ({ status, text: 'private-text' })),
      };
      await firstValueFrom(
        interceptor.intercept(
          context('WhatsappController', 'sendImageBatch', {
            user: actor,
            params: {},
            query: {},
            body: {},
          }),
          { handle: () => of(response) },
        ),
      );
      expect(entries[0].result).toBe(outcome);
      expect(entries[0].detail).not.toContain('private-text');
    },
  );

  it('reports unavailable audit persistence without recording a second business outcome', async () => {
    logs.append.mockRejectedValueOnce(
      new Error('both audit stores unavailable'),
    );
    await expect(
      firstValueFrom(
        interceptor.intercept(
          context('InquiriesController', 'create', {
            user: actor,
            params: {},
            body: {},
            query: {},
          }),
          { handle: () => of({ id: 'aa321860-25da-5d9f-831f-de9b3cf8c185' }) },
        ),
      ),
    ).rejects.toThrow('both audit stores unavailable');
    expect(logs.append).toHaveBeenCalledTimes(1);
  });
});
