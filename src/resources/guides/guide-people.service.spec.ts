import 'reflect-metadata';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ResourceStatus } from '../common/resource.constants';
import { GuidePeopleService } from './guide-people.service';
import { GuidePersonEntity } from './guide-person.entity';

function setup(busy: boolean) {
  const findOne = jest.fn().mockResolvedValue({
    id: 'guide',
    code: 'GPR-001',
    name: 'Guide',
    version: 1,
    status: ResourceStatus.Enabled,
  });
  const save = jest
    .fn()
    .mockImplementation((value: unknown) => Promise.resolve(value));
  const softDelete = jest.fn().mockResolvedValue({});
  const builder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    whereInIds: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
  };
  const repository = {
    findOne,
    save,
    softDelete,
    createQueryBuilder: () => builder,
  } as unknown as Repository<GuidePersonEntity>;
  const query = jest.fn().mockResolvedValue(busy ? [{}] : []);
  const manager = {
    query,
    getRepository: () => repository,
  } as unknown as EntityManager;
  const db = {
    transaction: <T>(work: (m: EntityManager) => Promise<T>) => work(manager),
  } as unknown as DataSource;
  return {
    service: new GuidePeopleService(repository, db),
    findOne,
    save,
    softDelete,
    query,
  };
}

describe('guide lifecycle during tour assignments', () => {
  it('rejects disabling a guide with an unfinished active tour before saving', async () => {
    const { service, findOne, save } = setup(true);
    await expect(
      service.update(
        'guide',
        { name: 'Guide', version: 1, status: ResourceStatus.Disabled },
        'actor',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(findOne).toHaveBeenCalledWith({
      where: { id: 'guide' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects deletion of an assigned guide without deleting any rows', async () => {
    const { service, softDelete } = setup(true);
    await expect(service.delete(['guide'], 'actor')).rejects.toMatchObject({
      status: 409,
    });
    expect(softDelete).not.toHaveBeenCalled();
  });
  it('allows deletion when no unfinished active tour remains, locking IDs in sorted order', async () => {
    const { service, findOne, softDelete, query } = setup(false);
    await service.delete(['b', 'a', 'a'], 'actor');
    expect(
      findOne.mock.calls.map(
        (call: [{ where: { id: string } }]) => call[0].where.id,
      ),
    ).toEqual(['a', 'b']);
    expect(softDelete).toHaveBeenCalledWith(['a', 'b']);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("AT TIME ZONE 'Asia/Shanghai'"),
      ['a'],
    );
  });
});
