import { CitiesService } from './cities.service';
import { ResourceStatus } from '../common/resource.constants';

describe('shared city options', () => {
  it('selects enabled undeleted entries and exposes only dropdown fields', async () => {
    const find = jest.fn().mockResolvedValue([
      {
        id: 'city',
        name: '昆明',
        status: 'enabled',
        code: 'CITY001',
        province: '云南',
        createdBy: 'private-user-id',
        version: 3,
      },
    ]);
    const args = [{ find }, {}] as unknown as ConstructorParameters<
      typeof CitiesService
    >;
    expect(await new CitiesService(...args).options()).toEqual([
      { id: 'city', name: '昆明', province: '云南', status: 'enabled' },
    ]);
    expect(find).toHaveBeenCalledWith({
      where: { status: ResourceStatus.Enabled },
      select: { id: true, name: true, province: true, status: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    // Repository.find excludes @DeleteDateColumn rows by default (no withDeleted).
  });
});
