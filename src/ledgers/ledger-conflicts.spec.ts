import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { ErrorCode } from '../common/constants/error-code';
import { BusinessException } from '../common/exceptions/business.exception';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { DirectLedgersService } from './direct-ledgers.service';
import { ShengxuLedgersService } from './shengxu-ledgers.service';
import { UpdateDirectLedgerDto, UpdateShengxuLedgerDto } from './ledger.dto';

// Local mocks only: no DataSource initialization, sockets or environment settings.
function fixture(unit: 'shengxu' | 'linxi') {
  const actor: AuthenticatedUser = {
    id: 'owner',
    identityId: 'identity',
    username: 'test',
    nickname: 'Test',
    scope: unit,
    scopeName: unit,
    deptId: 1,
    deptName: '',
    menuKeys: [],
    roles: ['BUSINESS_MANAGER', 'COORDINATOR'],
    permissions: [
      ...['create', 'update', 'delete', 'review', 'operate'].map(
        (action) =>
          `ledger:${unit === 'shengxu' ? 'shengxu' : 'direct'}:${action}`,
      ),
      'resource:agency:list',
    ],
  };
  const row = {
    id: 'ledger',
    businessUnit: unit,
    creatorId: actor.id,
    operatorId: actor.id,
    operatorName: 'Test',
    receivingGroupId: 'group',
    receivingAccountName: '定制师测试组',
    agencyId: 'agency',
    agencyName: 'Agency',
    contactId: 'contact',
    contactName: 'Contact',
    countryOrRegion: '',
    city: '',
    convertedGroups: 0,
    version: 2,
    orderStatus: 'unconverted',
    reviewedAt: null as Date | null,
    operatedAt: null as Date | null,
    operated: false,
    loss: true,
  };
  const query = jest.fn().mockResolvedValue([row]);
  const manager = { query } as unknown as EntityManager;
  const db = {
    transaction: (work: (manager: EntityManager) => Promise<unknown>) =>
      work(manager),
  } as unknown as DataSource;
  const directInput = Object.assign(new UpdateDirectLedgerDto(), {
    receivedDate: '2026-10-20',
    source: 'Customer',
    receivingGroupId: 'group',
    operatorId: actor.id,
    version: row.version,
  });
  const shengxuInput = Object.assign(new UpdateShengxuLedgerDto(), {
    recordDate: '2026-10-20',
    agencyId: row.agencyId,
    contactId: row.contactId,
    quotedGroups: 1,
    convertedGroups: 0,
    version: row.version,
  });
  return {
    actor,
    row,
    query,
    directInput,
    shengxuInput,
    direct: new DirectLedgersService(db),
    shengxu: new ShengxuLedgersService(db),
  };
}

async function expectConflict(work: Promise<unknown>, code: string) {
  const error: unknown = await work.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BusinessException);
  const exception = error as BusinessException;
  expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
  expect(exception.code).toBe(code);
  // Exercise the real filter too: it must not normalize the new code back to CONFLICT.
  const response = {
    locals: {},
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        path: '/api/ledgers/test',
        originalUrl: '/api/ledgers/test',
        method: 'PUT',
        headers: {},
      }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  new ApiExceptionFilter().catch(exception, host);
  expect(response.status).toHaveBeenCalledWith(409);
  expect(response.json).toHaveBeenCalledWith(
    expect.objectContaining({ code, data: null, details: {} }),
  );
}

describe('ledger conflict API codes', () => {
  it.each([false, true])(
    'creates Shengxu ledgers without a duty restriction (ROOT delegation=%s)',
    async (delegate) => {
      const f = fixture('shengxu');
      if (delegate) {
        f.actor.scope = 'headquarters';
        f.actor.roles = ['ROOT'];
      }
      f.query
        .mockResolvedValueOnce([{ ...f.row, coordinatorId: 'owner' }])
        .mockResolvedValueOnce([{ name: 'Contact' }])
        .mockResolvedValueOnce([{ id: 'owner', name: 'Test' }]);
      await f.shengxu.create(f.shengxuInput, f.actor);
      expect(f.query).toHaveBeenNthCalledWith(
        3,
        expect.not.stringContaining('coordinator_duty'),
        ['shengxu', 'owner'],
      );
      expect(f.query).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('INSERT INTO shengxu_ledgers'),
        expect.arrayContaining(['owner', 'Test']),
      );
    },
  );

  it('offers ROOT agencies linked to any enabled Shengxu coordinator', async () => {
    const f = fixture('shengxu');
    f.actor.scope = 'headquarters';
    f.actor.roles = ['ROOT'];
    f.actor.permissions.push('ledger:shengxu:list');
    const db = { query: f.query } as unknown as DataSource;
    f.query.mockResolvedValueOnce([{ total: '0' }]).mockResolvedValueOnce([]);
    await new ShengxuLedgersService(db).agencies(
      { page: 1, pageSize: 20 },
      f.actor,
    );
    const [sql] = f.query.mock.calls[0] as [string];
    expect(sql).not.toContain('coordinator_duty');
    expect(sql).toContain("r.code='COORDINATOR' AND r.is_enabled");
    expect(sql).toContain('u.id=resource_agencies.coordinator_id');
  });

  it.each(['create', 'update'] as const)(
    'maps Shengxu %s unique violation precisely',
    async (action) => {
      const f = fixture('shengxu');
      const duplicate = new QueryFailedError(
        'write',
        [],
        Object.assign(new Error('duplicate'), {
          code: '23505',
          constraint: 'uq_shengxu_ledger_date_agency',
        }),
      );
      if (action === 'create') {
        f.query
          .mockResolvedValueOnce([f.row])
          .mockResolvedValueOnce([{ name: 'Contact' }])
          .mockRejectedValueOnce(duplicate);
      } else {
        f.query.mockResolvedValueOnce([f.row]).mockRejectedValueOnce(duplicate);
      }
      await expectConflict(
        action === 'create'
          ? f.shengxu.create(f.shengxuInput, f.actor)
          : f.shengxu.update(f.row.id, f.shengxuInput, f.actor),
        ErrorCode.SHENGXU_LEDGER_DUPLICATE,
      );
    },
  );

  it('does not label unrelated database errors as duplicate ledger', async () => {
    const f = fixture('shengxu');
    const error = new QueryFailedError(
      'write',
      [],
      Object.assign(new Error('constraint'), {
        code: '23514',
        constraint: 'another_constraint',
      }),
    );
    f.query.mockResolvedValueOnce([f.row]).mockRejectedValueOnce(error);
    await expect(
      f.shengxu.update(f.row.id, f.shengxuInput, f.actor),
    ).rejects.toBe(error);
  });

  it('distinguishes converted Shengxu deletion from duplicate or stale version', async () => {
    const f = fixture('shengxu');
    f.row.convertedGroups = 1;
    await expectConflict(
      f.shengxu.delete(f.row.id, 2, f.actor),
      ErrorCode.SHENGXU_LEDGER_DELETE_CONVERTED,
    );
    expect(f.query).toHaveBeenCalledTimes(1);
  });

  it.each(['update', 'delete'] as const)(
    'prioritizes stale Shengxu version for %s',
    async (action) => {
      const f = fixture('shengxu');
      f.row.convertedGroups = 1;
      await expectConflict(
        action === 'update'
          ? f.shengxu.update(
              f.row.id,
              { ...f.shengxuInput, version: 1 },
              f.actor,
            )
          : f.shengxu.delete(f.row.id, 1, f.actor),
        ErrorCode.LEDGER_VERSION_CONFLICT,
      );
      expect(f.query).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['update', 'review', 'operate', 'delete'] as const)(
    'prioritizes stale direct version for %s',
    async (action) => {
      const f = fixture('linxi');
      f.row.reviewedAt = new Date();
      const work = {
        update: () =>
          f.direct.update(f.row.id, { ...f.directInput, version: 1 }, f.actor),
        review: () => f.direct.review(f.row.id, 1, f.actor),
        operate: () => f.direct.operate(f.row.id, { version: 1 }, f.actor),
        delete: () => f.direct.delete(f.row.id, 1, f.actor),
      };
      await expectConflict(work[action](), ErrorCode.LEDGER_VERSION_CONFLICT);
      expect(f.query).toHaveBeenCalledTimes(1);
    },
  );

  it('distinguishes reviewed update from repeat review', async () => {
    const f = fixture('linxi');
    f.row.reviewedAt = new Date();
    await expectConflict(
      f.direct.update(f.row.id, f.directInput, f.actor),
      ErrorCode.DIRECT_LEDGER_REVIEWED_READ_ONLY,
    );
    await expectConflict(
      f.direct.review(f.row.id, 2, f.actor),
      ErrorCode.DIRECT_LEDGER_NOT_PENDING_CONFIRMATION,
    );
  });

  it('rejects status rollback even after the operated mark was cancelled', async () => {
    const f = fixture('linxi');
    f.row.orderStatus = 'converted';
    f.row.operatedAt = new Date();
    await expectConflict(
      f.direct.update(f.row.id, f.directInput, f.actor),
      ErrorCode.DIRECT_LEDGER_OPERATED_READ_ONLY,
    );
    expect(f.query).toHaveBeenCalledTimes(1);
  });

  it.each(['unconfirmed-loss', 'already-operated'])(
    'rejects operation for %s',
    async (state) => {
      const f = fixture('linxi');
      f.row.operated = state === 'already-operated';
      await expectConflict(
        f.direct.operate(f.row.id, { version: 2 }, f.actor),
        ErrorCode.DIRECT_LEDGER_NOT_PENDING_OPERATION,
      );
      expect(f.query).toHaveBeenCalledTimes(1);
    },
  );

  it('does not confirm a no-loss entry', async () => {
    const f = fixture('linxi');
    f.row.loss = false;
    await expectConflict(
      f.direct.review(f.row.id, 2, f.actor),
      ErrorCode.DIRECT_LEDGER_NOT_PENDING_CONFIRMATION,
    );
  });

  it.each([
    [true, true, ErrorCode.DIRECT_LEDGER_DELETE_REVIEWED],
    [false, true, ErrorCode.DIRECT_LEDGER_DELETE_OPERATED],
    [false, false, ErrorCode.DIRECT_LEDGER_DELETE_CONVERTED],
  ] as const)(
    'returns the highest priority deletion reason (reviewed=%s, operated=%s)',
    async (reviewed, operated, code) => {
      const f = fixture('linxi');
      f.row.orderStatus = 'converted';
      f.row.reviewedAt = reviewed ? new Date() : null;
      f.row.operatedAt = operated ? new Date() : null;
      await expectConflict(f.direct.delete(f.row.id, 2, f.actor), code);
      expect(f.query).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps permission rejection ahead of conflict details', async () => {
    const f = fixture('linxi');
    f.actor.scope = 'headquarters';
    await expect(f.direct.delete(f.row.id, 1, f.actor)).rejects.toMatchObject({
      code: ErrorCode.AUTH_FORBIDDEN,
    });
    expect(f.query).not.toHaveBeenCalled();
  });
});
