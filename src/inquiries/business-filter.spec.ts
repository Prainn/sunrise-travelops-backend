import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { InquiriesService } from './inquiries.service';
import { InquiryInput, InquiryQuery, LogQuery } from './inquiry.dto';
import { ItineraryValidation } from './itinerary-validation';
import { AgenciesService } from '../resources/agencies/agencies.service';

type Actor = Parameters<InquiriesService['list']>[1];
const headquarters: Actor = {
  id: 'boss',
  username: 'boss',
  nickname: 'Boss',
  name: 'Boss',
  identityId: 'identity',
  scope: 'headquarters',
  scopeName: '总部',
  deptId: 4,
  deptName: '总经办',
  roles: ['EXECUTIVE'],
  permissions: ['inquiry:list', 'itinerary:list'],
  resourceLibrary: null,
  admin: false,
  ip: '',
  requestId: '',
};

function setup() {
  const qb = {
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 37]),
    clone: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({
      totalOperations: '37',
      inquiryCount: '12',
      operatorCount: '3',
      changedFields: '8',
    }),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
  const db = { manager: { createQueryBuilder: jest.fn(() => qb) } };
  const service = new InquiriesService(
    db as unknown as DataSource,
    {} as ItineraryValidation,
    {} as AgenciesService,
  );
  return { service, qb };
}

describe('headquarters business filters', () => {
  it.each(['COORDINATOR', 'BUSINESS_MANAGER'])(
    'rejects assigning a new inquiry to another person for %s',
    async (role) => {
      const manager = { save: jest.fn(), findOne: jest.fn() };
      const service = new InquiriesService(
        {
          transaction: (action: (manager: EntityManager) => unknown) =>
            action(manager as unknown as EntityManager),
        } as DataSource,
        {} as ItineraryValidation,
        {} as AgenciesService,
      );
      await expect(
        service.create(
          Object.assign(new InquiryInput(), { ownerId: 'another-user' }),
          {
            ...headquarters,
            scope: 'shengxu',
            roles: [role],
            admin: role === 'BUSINESS_MANAGER',
            permissions: ['inquiry:create'],
          },
        ),
      ).rejects.toMatchObject({ code: 'INQUIRY_OWNER_INVALID', status: 403 });
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    },
  );

  it('applies the business filter before paginating and preserves database totals', async () => {
    const { service, qb } = setup();
    const result = await service.list(
      { page: 2, pageSize: 10, businessUnit: 'linxi' },
      headquarters,
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      'i.businessUnit = :filterBusinessUnit',
      { filterBusinessUnit: 'linxi' },
    );
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(10);
    expect(result).toEqual({ list: [], total: 37, page: 2, pageSize: 10 });
  });

  it('does not constrain headquarters to a business when the filter is omitted', async () => {
    const { service, qb } = setup();
    await service.list({ page: 1, pageSize: 10 }, headquarters);
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it.each(['list', 'logs', 'report'] as const)(
    'rejects cross-business filters on %s for ordinary accounts',
    async (method) => {
      const { service, qb } = setup();
      const coordinator: Actor = {
        ...headquarters,
        scope: 'shengxu',
        roles: ['COORDINATOR'],
        resourceLibrary: 'shengxu',
      };
      await expect(
        service[method](
          { page: 1, pageSize: 10, businessUnit: 'website' },
          coordinator,
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(qb.getManyAndCount).not.toHaveBeenCalled();
      expect(qb.getRawOne).not.toHaveBeenCalled();
    },
  );

  it('preserves owner scope when an ordinary account filters its own business', async () => {
    const { service, qb } = setup();
    await service.list(
      { page: 1, pageSize: 10, businessUnit: 'shengxu' },
      {
        ...headquarters,
        scope: 'shengxu',
        roles: ['COORDINATOR'],
        resourceLibrary: 'shengxu',
      },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('i.ownerId = :actorId', {
      actorId: 'boss',
    });
  });

  it('uses the same business condition for logs and aggregate counts', async () => {
    const { service, qb } = setup();
    await service.logs(
      { page: 1, pageSize: 10, businessUnit: 'website' },
      headquarters,
    );
    const report = await service.report(
      { page: 1, pageSize: 10, businessUnit: 'website' },
      headquarters,
    );
    expect(
      qb.andWhere.mock.calls.filter(
        ([sql]) => sql === 'i.businessUnit = :filterBusinessUnit',
      ),
    ).toEqual([
      [
        'i.businessUnit = :filterBusinessUnit',
        { filterBusinessUnit: 'website' },
      ],
      [
        'i.businessUnit = :filterBusinessUnit',
        { filterBusinessUnit: 'website' },
      ],
    ]);
    expect(report.inquiryCount).toBe(12);
    expect(report.totalOperations).toBe(37);
  });

  it.each([InquiryQuery, LogQuery])(
    'rejects headquarters as a business filter',
    async (dto) => {
      const errors = await validate(
        plainToInstance(dto, {
          page: 1,
          pageSize: 10,
          businessUnit: 'headquarters',
        }),
      );
      expect(errors.some((error) => error.property === 'businessUnit')).toBe(
        true,
      );
    },
  );
});
