import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource } from 'typeorm';
import { WebsiteLogQuery, WebsiteUpdateInquiryDto } from './website.dto';
import type { WebsiteInquiry } from './website.types';
import { WebsiteService } from './website.service';
import { effectivePermissions } from '../auth/identity-permissions';
import type { AuthenticatedUser } from '../auth/auth.types';

const user = (
  scope: AuthenticatedUser['scope'] = 'website',
  role = 'COORDINATOR',
): AuthenticatedUser => ({
  id: 'b9a089f0-7a3c-48b0-a17e-a8a6f2345012',
  identityId: 'identity',
  username: 'planner',
  nickname: '计调',
  scope,
  scopeName: scope,
  roles: [role],
  permissions: effectivePermissions(scope, [role]),
  menuKeys: ['website-inquiry-summary'],
  deptId: null,
  deptName: '',
});

describe('website log query basics (no database connection)', () => {
  it.each([
    { from: '2026-02-30' },
    { to: '2026-10-22T00:00:00Z' },
    { action: '' },
    { action: 'itinerary_pdf_generated' },
    { businessUnit: 'shengxu' },
    { operatorId: 'not-a-uuid' },
    { pageSize: '101' },
    { keyword: 'unsupported' },
  ])('rejects invalid query %j', async (input) => {
    const errors = await validate(plainToInstance(WebsiteLogQuery, input), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('normalizes pagination/number query and accepts strict leap date', async () => {
    const query = plainToInstance(WebsiteLogQuery, {
      page: '2',
      pageSize: '10',
      inquiryCode: ' WIQ-1 ',
      from: '2028-02-29',
    });
    expect(
      await validate(query, { whitelist: true, forbidNonWhitelisted: true }),
    ).toEqual([]);
    expect(query).toMatchObject({
      page: 2,
      pageSize: 10,
      inquiryCode: 'WIQ-1',
    });
  });

  it.each([
    user('shengxu'),
    user('website', 'RESOURCE_MANAGER'),
    user('linxi', 'RESOURCE_MANAGER'),
  ])('rejects non-business identities before querying logs', async (actor) => {
    const query = jest.fn();
    const service = new WebsiteService({
      manager: { query },
    } as unknown as DataSource);
    for (const method of [
      'inquiryLogs',
      'inquiryLogReport',
      'inquiryLogOperators',
    ] as const) {
      await expect(
        service[method](new WebsiteLogQuery(), actor),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects cross-business requests and reversed date ranges before querying', async () => {
    const query = jest.fn();
    const service = new WebsiteService({
      manager: { query },
    } as unknown as DataSource);
    await expect(
      service.inquiryLogs(
        plainToInstance(WebsiteLogQuery, { businessUnit: 'linxi' }),
        user(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.inquiryLogReport(
        plainToInstance(WebsiteLogQuery, {
          from: '2026-10-23',
          to: '2026-10-22',
        }),
        user(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('checks source inquiry visibility for direct IDs in every endpoint', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new WebsiteService({
      manager: { query },
    } as unknown as DataSource);
    for (const method of [
      'inquiryLogs',
      'inquiryLogReport',
      'inquiryLogOperators',
    ] as const) {
      await expect(
        service[method](
          plainToInstance(WebsiteLogQuery, {
            inquiryId: 'b9a089f0-7a3c-48b0-a17e-a8a6f2345013',
          }),
          user(),
        ),
      ).rejects.toMatchObject({ status: 404 });
    }
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('retains unknown historical actions and reports incomplete field coverage', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        totalOperations: '3',
        inquiryCount: '2',
        operatorCount: '2',
        changedFields: '4',
        logsWithoutChanges: '1',
        byAction: [
          { action: 'inquiry_updated', count: 2 },
          { action: 'old_action', count: 1 },
        ],
      },
    ]);
    const service = new WebsiteService({
      manager: { query },
    } as unknown as DataSource);
    const result = await service.inquiryLogReport(
      new WebsiteLogQuery(),
      user(),
    );
    expect(result).toMatchObject({
      totalOperations: 3,
      inquiryCount: 2,
      operatorCount: 2,
      changedFields: 4,
      logsWithoutChanges: 1,
    });
    expect(result.byAction).toEqual(
      expect.arrayContaining([
        { action: 'old_action', count: 1 },
        { action: 'quotation_confirmed', count: 0 },
      ]),
    );
  });
});

describe('website inquiry save audit (transaction manager stub)', () => {
  it.each(['unchanged', 'edited', 'lost'] as const)(
    '%s produces only the appropriate success log',
    async (mode) => {
      const input = plainToInstance(WebsiteUpdateInquiryDto, {
        countryItemId: 'country',
        customerName: '客户',
        plannedDays: 2,
        requirements: '需求',
        version: 1,
      });
      const before: WebsiteInquiry = {
        canDelete: false,
        ...input,
        id: 'inquiry',
        code: 'WIQ-1',
        businessUnit: 'website',
        ownerId: user().id,
        owner: '计调',
        status: 'new',
        countryCode: 'CHN',
        countryOrRegion: '中国',
        hasActiveTour: false,
        createdAt: '',
        updatedAt: '',
      };
      if (mode === 'edited') input.customerName = '新称呼';
      if (mode === 'lost') {
        input.status = 'lost';
        input.lostReason = '行程取消';
      }
      const after = {
        ...before,
        ...input,
        ownerId: before.ownerId,
        status: input.status ?? before.status,
        version: 2,
      };
      const query = jest
        .fn()
        .mockResolvedValueOnce([before])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([after])
        .mockResolvedValue([]);
      const manager = { query };
      const transaction = jest.fn(
        (work: (value: typeof manager) => Promise<WebsiteInquiry>) =>
          work(manager),
      );
      const service = new WebsiteService({
        transaction,
      } as unknown as DataSource);
      await expect(
        service.update(before.id, input, user()),
      ).resolves.toMatchObject({ version: 2 });
      expect(transaction).toHaveBeenCalledTimes(1);
      const calls = query.mock.calls as [string, unknown[]][];
      const inserts = calls.filter(([sql]) =>
        sql.includes('INSERT INTO website_logs'),
      );
      if (mode === 'unchanged') expect(inserts).toHaveLength(0);
      else {
        expect(inserts).toHaveLength(1);
        const params = inserts[0][1];
        expect(params[2]).toBe(
          mode === 'lost' ? 'inquiry_lost' : 'inquiry_updated',
        );
        expect(params[8]).toBe('planner');
        const changes = JSON.parse(String(params[12])) as { path: string }[];
        expect(changes.map((change) => change.path)).toEqual(
          mode === 'lost' ? ['status', 'lostReason'] : ['customerName'],
        );
        if (mode === 'lost')
          expect(JSON.parse(String(params[13]))).toEqual({
            lostReason: '行程取消',
          });
      }
    },
  );
});
