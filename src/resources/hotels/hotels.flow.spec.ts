import { DataSource, EntityManager, Repository } from 'typeorm';
import { ResourceStatus } from '../common/resource.constants';
import { ResourceValidationService } from '../common/resource-validation.service';
import { HotelEntity } from './hotel.entity';
import { HotelsService } from './hotels.service';

const actorId = '00000000-0000-4000-8000-000000000099';
const hotelId = '00000000-0000-4000-8000-000000000001';

describe('HotelsService resource lifecycle', () => {
  it('creates, queries and formats monetary values', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const create = jest.fn((value) => value as HotelEntity);
    const save = jest.fn((value: Partial<HotelEntity>) =>
      Promise.resolve(entity(value)),
    );
    const findOneBy = jest.fn().mockResolvedValue(entity());
    const repository = {
      findOne,
      create,
      save,
      findOneBy,
    } as unknown as Repository<HotelEntity>;
    const validateUnit = jest.fn().mockResolvedValue(undefined);
    const service = new HotelsService(
      repository,
      { validateUnit } as unknown as ResourceValidationService,
      {} as DataSource,
    );

    const created = await service.create(input(), actorId);
    expect(validateUnit).toHaveBeenCalledWith('roomNight', 'hotel');
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );
    expect(created).toMatchObject({
      id: hotelId,
      individualPrice: '120.00',
      groupPrice: null,
    });

    const found = await service.get(hotelId);
    expect(findOneBy).toHaveBeenCalledWith({ id: hotelId });
    expect(found.individualPrice).toBe('120.00');
  });

  it('updates under a row lock and returns the incremented version', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(entity())
      .mockResolvedValueOnce(null);
    const save = jest.fn((value: HotelEntity) =>
      Promise.resolve(entity({ ...value, version: 2 })),
    );
    const repository = { findOne, save } as unknown as Repository<HotelEntity>;
    const manager = {
      getRepository: jest.fn().mockReturnValue(repository),
    } as unknown as EntityManager;
    const transaction = jest.fn(
      (callback: (manager: EntityManager) => unknown) => callback(manager),
    );
    const validateUnit = jest.fn().mockResolvedValue(undefined);
    const service = new HotelsService(
      {} as Repository<HotelEntity>,
      { validateUnit } as unknown as ResourceValidationService,
      { transaction } as unknown as DataSource,
    );

    const updated = await service.update(
      hotelId,
      { ...input(), id: hotelId, version: 1, groupPrice: '100' },
      actorId,
    );
    expect(findOne).toHaveBeenNthCalledWith(1, {
      where: { id: hotelId },
      lock: { mode: 'pessimistic_write' },
    });
    expect(updated).toMatchObject({ version: 2, groupPrice: '100.00' });
  });
});

function input() {
  return {
    code: 'HTL001',
    name: 'Test Hotel',
    province: 'Yunnan',
    city: 'Kunming',
    rating: 'international_five_star',
    facilities: '',
    breakfast: '',
    address: '',
    phone: '',
    nearby: '',
    basicRoomType: 'Twin',
    individualPrice: '120',
    groupPrice: null,
    minimumGroupSize: null,
    unit: 'roomNight',
    status: ResourceStatus.Enabled,
  };
}

function entity(change: Partial<HotelEntity> = {}): HotelEntity {
  return {
    ...input(),
    id: hotelId,
    version: 1,
    individualPrice: '120.00',
    createdAt: new Date('2026-09-04T01:00:00Z'),
    createdBy: actorId,
    updatedAt: new Date('2026-09-04T01:00:00Z'),
    updatedBy: actorId,
    deletedAt: null,
    ...change,
  };
}
