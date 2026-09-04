import { DataSource, EntityManager, Repository } from 'typeorm';
import { ResourceValidationService } from '../common/resource-validation.service';
import { HotelEntity } from './hotel.entity';
import { HotelsService } from './hotels.service';

describe('HotelsService', () => {
  it('does not partially soft-delete when any requested id is missing', async () => {
    const repository = {
      findBy: jest.fn().mockResolvedValue([{ id: 'found' }]),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<Repository<HotelEntity>>;
    const manager = {
      getRepository: jest.fn().mockReturnValue(repository),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn((callback: (manager: EntityManager) => unknown) =>
        callback(manager),
      ),
    } as unknown as DataSource;
    const service = new HotelsService(
      {} as Repository<HotelEntity>,
      {} as ResourceValidationService,
      dataSource,
    );
    await expect(
      service.delete(['found', 'missing'], 'actor'),
    ).rejects.toMatchObject({
      code: 'HOTEL_NOT_FOUND',
      details: { missingIds: ['missing'] },
    });
    expect((repository.softDelete as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('soft-deletes every requested resource in one transaction', async () => {
    const execute = jest.fn().mockResolvedValue({ affected: 2 });
    const builder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      whereInIds: jest.fn().mockReturnThis(),
      execute,
    };
    const softDelete = jest.fn().mockResolvedValue({ affected: 2 });
    const repository = {
      findBy: jest.fn().mockResolvedValue([{ id: 'one' }, { id: 'two' }]),
      createQueryBuilder: jest.fn().mockReturnValue(builder),
      softDelete,
    } as unknown as Repository<HotelEntity>;
    const manager = {
      getRepository: jest.fn().mockReturnValue(repository),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn((callback: (manager: EntityManager) => unknown) =>
        callback(manager),
      ),
    } as unknown as DataSource;
    const service = new HotelsService(
      {} as Repository<HotelEntity>,
      {} as ResourceValidationService,
      dataSource,
    );
    await service.delete(['one', 'two'], 'actor');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(softDelete).toHaveBeenCalledWith(['one', 'two']);
  });
});
