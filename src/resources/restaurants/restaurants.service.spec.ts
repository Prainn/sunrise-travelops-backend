import { DataSource, EntityManager, Repository } from 'typeorm';
import { ResourceValidationService } from '../common/resource-validation.service';
import { RestaurantEntity, RestaurantPriceEntity } from './restaurant.entity';
import { RestaurantsService } from './restaurants.service';

describe('RestaurantsService prices', () => {
  it('saves a unified restaurant price without supplier validation', async () => {
    const parentRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'restaurant' }),
    } as unknown as Repository<RestaurantEntity>;
    const create = jest.fn((value) => value as RestaurantPriceEntity);
    const save = jest.fn((value: Partial<RestaurantPriceEntity>) =>
      Promise.resolve({
        ...value,
        id: 'price',
        version: 1,
        createdAt: new Date('2026-09-04T01:00:00Z'),
        createdBy: 'actor',
        updatedAt: new Date('2026-09-04T01:00:00Z'),
        updatedBy: 'actor',
      } as RestaurantPriceEntity),
    );
    const priceRepository = {
      create,
      save,
    } as unknown as Repository<RestaurantPriceEntity>;
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === RestaurantEntity ? parentRepository : priceRepository,
      ),
    } as unknown as EntityManager;
    const validateUnit = jest.fn().mockResolvedValue(undefined);
    const validateGroundOperator = jest
      .fn()
      .mockResolvedValue('00000000-0000-4000-8000-000000000002');
    const service = new RestaurantsService(
      {} as Repository<RestaurantEntity>,
      {} as Repository<RestaurantPriceEntity>,
      {
        validateUnit,
        validateGroundOperator,
      } as unknown as ResourceValidationService,
      {
        transaction: (callback: (manager: EntityManager) => unknown) =>
          callback(manager),
      } as DataSource,
    );

    const result = await service.createPrice(
      'restaurant',
      {
        menuName: 'Dinner',
        dishDetails: '',
        unit: 'personMeal',
        price: '88',
        dinerCount: null,
        remark: '',
      },
      'actor',
    );
    expect(validateUnit).toHaveBeenCalledWith('personMeal', 'restaurant');
    expect(validateGroundOperator).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('groundOperatorId');
    expect(result).toMatchObject({
      price: '88.00',
    });
  });
});
