import { DataSource, Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { RoleEntity } from '../roles/role.entity';
import { UserEntity } from './user.entity';
import { UserManagementService } from './user-management.service';

describe('UserManagementService.delete', () => {
  const actor = {
    id: 'actor-id',
    scope: 'shengxu',
    roles: ['BUSINESS_MANAGER'],
  } as AuthenticatedUser;

  function setup(targetRoles: string[]) {
    const target = {
      id: 'target-id',
      identities: [
        {
          scope: 'shengxu',
          roles: targetRoles.map((code) => ({ code })),
        },
      ],
    } as UserEntity;
    const queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(target),
    };
    const manager = {
      findOne: jest.fn().mockResolvedValue(target),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      query: jest.fn().mockResolvedValue([{ total: 0, unfinished: 0 }]),
      delete: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      manager,
      transaction: jest.fn(
        (callback: (value: typeof manager) => Promise<void>) =>
          callback(manager),
      ),
    } as unknown as DataSource;
    const service = new UserManagementService(
      {} as Repository<UserEntity>,
      {} as Repository<RoleEntity>,
      dataSource,
    );
    return { service, manager };
  }

  it('rejects deleting another business manager before changing the account', async () => {
    const { service, manager } = setup(['BUSINESS_MANAGER']);

    await expect(service.delete(['target-id'], actor)).rejects.toMatchObject({
      response: { code: 'AUTH_FORBIDDEN' },
    });
    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.softDelete).not.toHaveBeenCalled();
  });

  it('allows deleting an ordinary account in the same business', async () => {
    const { service, manager } = setup(['COORDINATOR']);

    await service.delete(['target-id'], actor);
    expect(manager.softDelete).toHaveBeenCalledWith(UserEntity, 'target-id');
  });
});
