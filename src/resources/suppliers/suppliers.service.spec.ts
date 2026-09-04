import {
  DataSource,
  EntityManager,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { AttractionPriceEntity } from '../attractions/attraction.entity';
import { GuideEntity } from '../guides/guide.entity';
import { RestaurantPriceEntity } from '../restaurants/restaurant.entity';
import { SupplierEntity } from './supplier.entity';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  it('rejects deletion and reports active reference types and counts', async () => {
    const suppliers = {
      findBy: jest.fn().mockResolvedValue([{ id: 'supplier' }]),
      softDelete: jest.fn(),
    } as unknown as Repository<SupplierEntity>;
    const counts = new Map<unknown, number>([
      [RestaurantPriceEntity, 2],
      [AttractionPriceEntity, 1],
      [GuideEntity, 0],
    ]);
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === SupplierEntity) return suppliers;
        const builder = {
          where: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(counts.get(entity) ?? 0),
        } as unknown as SelectQueryBuilder<RestaurantPriceEntity>;
        return { createQueryBuilder: jest.fn().mockReturnValue(builder) };
      }),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn((callback: (manager: EntityManager) => unknown) =>
        callback(manager),
      ),
    } as unknown as DataSource;
    const service = new SuppliersService(
      {} as Repository<SupplierEntity>,
      dataSource,
    );
    await expect(service.delete(['supplier'], 'actor')).rejects.toMatchObject({
      code: 'RESOURCE_IN_USE',
      details: {
        references: [
          { type: 'restaurantPrice', count: 2 },
          { type: 'attractionPrice', count: 1 },
        ],
      },
    });
    expect((suppliers.softDelete as jest.Mock).mock.calls).toHaveLength(0);
  });
});
