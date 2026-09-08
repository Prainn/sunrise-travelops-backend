import { DataSource, EntityManager, Repository } from 'typeorm';
import { CitiesService } from './cities.service';
import { CityEntity } from './city.entity';
import { ResourceStatus } from '../common/resource.constants';
const input = {
  code: 'CITY-001',
  name: '昆明',
  province: '云南省',
  status: ResourceStatus.Enabled,
};
const city = {
  ...input,
  id: '00000000-0000-4000-8000-000000000001',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  updatedBy: null,
  deletedAt: null,
} as CityEntity;

describe('city resource lifecycle', () => {
  it('creates cities and returns only enabled options', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Partial<CityEntity>) => value),
      save: jest.fn().mockResolvedValue(city),
      find: jest.fn().mockResolvedValue([city]),
    };
    const service = new CitiesService(
      repository as unknown as Repository<CityEntity>,
      {} as DataSource,
    );
    expect(await service.create(input, city.id)).toMatchObject({
      name: '昆明',
      version: 1,
    });
    expect(await service.options()).toEqual([
      expect.objectContaining({ name: '昆明' }),
    ]);
    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: ResourceStatus.Enabled } }),
    );
  });
  it('updates status under a version lock and rejects renaming a city', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(city),
      save: jest.fn((value: CityEntity) => Promise.resolve(value)),
    };
    const manager = {
      getRepository: () => repository,
    } as unknown as EntityManager;
    const service = new CitiesService(
      repository as unknown as Repository<CityEntity>,
      {
        transaction: (fn: (manager: EntityManager) => unknown) => fn(manager),
      } as DataSource,
    );
    await expect(
      service.update(city.id, { ...input, name: '大理', version: 1 }, city.id),
    ).rejects.toMatchObject({
      response: { code: 'CONFLICT' },
    });
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: city.id },
      lock: { mode: 'pessimistic_write' },
    });
  });
});
