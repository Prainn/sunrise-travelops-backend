import { ResourceValidationService } from '../common/resource-validation.service';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { SupplierEntity } from './supplier.entity';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  it('updates audit fields before soft deletion', async () => {
    const builder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      whereInIds: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const softDelete = jest.fn().mockResolvedValue(undefined);
    const suppliers = {
      findBy: jest.fn().mockResolvedValue([{ id: 'supplier' }]),
      createQueryBuilder: jest.fn().mockReturnValue(builder),
      softDelete,
    } as unknown as Repository<SupplierEntity>;
    const manager = {
      getRepository: jest.fn().mockReturnValue(suppliers),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn((callback: (manager: EntityManager) => unknown) =>
        callback(manager),
      ),
    } as unknown as DataSource;
    const service = new SuppliersService(
      {} as Repository<SupplierEntity>,
      dataSource,
      {} as ResourceValidationService,
    );
    await service.delete(['supplier'], 'actor');
    expect(builder.set).toHaveBeenCalledWith({ updatedBy: 'actor' });
    expect(builder.whereInIds).toHaveBeenCalledWith(['supplier']);
    expect(softDelete).toHaveBeenCalledWith(['supplier']);
  });
});
