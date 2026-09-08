import { DataSource, EntityManager, Repository } from 'typeorm';
import { ResourceValidationService } from '../common/resource-validation.service';
import { AttractionEntity, AttractionPriceEntity } from './attraction.entity';
import { AttractionsService } from './attractions.service';

describe('AttractionsService', () => {
  let attractions: jest.Mocked<Repository<AttractionEntity>>;
  let prices: jest.Mocked<Repository<AttractionPriceEntity>>;
  let validation: jest.Mocked<ResourceValidationService>;
  let dataSource: jest.Mocked<DataSource>;
  let service: AttractionsService;
  let createPriceEntity: jest.Mock;

  beforeEach(() => {
    attractions = {} as jest.Mocked<Repository<AttractionEntity>>;
    createPriceEntity = jest.fn((value) => value as AttractionPriceEntity);
    prices = {
      create: createPriceEntity,
      save: jest.fn((value) =>
        Promise.resolve({
          ...value,
          id: '00000000-0000-4000-8000-000000000010',
          version: 1,
          createdAt: new Date('2026-09-04T01:00:00Z'),
          createdBy: 'actor',
          updatedAt: new Date('2026-09-04T01:00:00Z'),
          updatedBy: 'actor',
        } as AttractionPriceEntity),
      ),
    } as unknown as jest.Mocked<Repository<AttractionPriceEntity>>;
    validation = {
      validateUnit: jest.fn().mockResolvedValue(undefined),
      validateGroundOperator: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ResourceValidationService>;
    const parentRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000001',
      }),
    } as unknown as Repository<AttractionEntity>;
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === AttractionEntity ? parentRepository : prices,
      ),
    } as unknown as EntityManager;
    dataSource = {
      transaction: jest.fn((callback: (manager: EntityManager) => unknown) =>
        callback(manager),
      ),
    } as unknown as jest.Mocked<DataSource>;
    service = new AttractionsService(
      attractions,
      prices,
      validation,
      dataSource,
    );
  });

  it('applies keyword, area, and category filters in the list query', async () => {
    const builder = {
      loadRelationCountAndMap: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    attractions.createQueryBuilder = jest.fn().mockReturnValue(builder);

    await service.list({
      page: 1,
      pageSize: 10,
      keyword: '日落',
      area: '大理',
      category: 'scenic',
    });

    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('attraction.remark ILIKE :keyword'),
      { keyword: '%日落%' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith('attraction.area = :area', {
      area: '大理',
    });
    expect(builder.andWhere).toHaveBeenCalledWith(
      'attraction.category = :category',
      { category: 'scenic' },
    );
  });

  it('stores both amounts as 0.00 for a free price', async () => {
    const result = await service.createPrice(
      '00000000-0000-4000-8000-000000000001',
      {
        itemType: 'ticket',
        itemName: 'Child',
        audience: 'child',
        periodName: '',
        startDate: null,
        endDate: null,
        rackPrice: '100',
        settlementPrice: '80',
        unit: 'personVisit',
        isFree: true,
        priceNote: '',
      },
      'actor',
    );
    expect(result).toMatchObject({
      rackPrice: '0.00',
      settlementPrice: '0.00',
    });
    expect(createPriceEntity).toHaveBeenCalledWith(
      expect.objectContaining({ rackPrice: '0.00', settlementPrice: '0.00' }),
    );
  });

  it('rejects a reversed price date range before writing', async () => {
    await expect(
      service.createPrice(
        '00000000-0000-4000-8000-000000000001',
        {
          itemType: 'ticket',
          itemName: 'Adult',
          audience: '',
          periodName: '',
          startDate: '2026-10-02',
          endDate: '2026-10-01',
          rackPrice: '1',
          settlementPrice: '1',
          unit: 'personVisit',
          isFree: false,
          priceNote: '',
        },
        'actor',
      ),
    ).rejects.toMatchObject({ code: 'ATTRACTION_PRICE_DATE_INVALID' });
    expect((dataSource.transaction as jest.Mock).mock.calls).toHaveLength(0);
  });
});
