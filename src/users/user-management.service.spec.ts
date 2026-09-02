import { DataSource, Repository } from 'typeorm';
import { RoleEntity } from '../roles/role.entity';
import { UserEntity, UserStatus } from './user.entity';
import { UserManagementService } from './user-management.service';

describe('UserManagementService', () => {
  let users: jest.Mocked<Repository<UserEntity>>;
  let roles: jest.Mocked<Repository<RoleEntity>>;
  let dataSource: jest.Mocked<DataSource>;
  let service: UserManagementService;

  beforeEach(() => {
    users = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<UserEntity>>;
    roles = {} as jest.Mocked<Repository<RoleEntity>>;
    dataSource = {
      transaction: jest.fn(),
    } as unknown as jest.Mocked<DataSource>;
    service = new UserManagementService(users, roles, dataSource);
  });

  it('prevents the current user from deleting their own account', async () => {
    const actorId = '00000000-0000-4000-8000-000000000999';

    await expect(service.delete([actorId], actorId)).rejects.toMatchObject({
      code: 'CURRENT_USER_CANNOT_BE_DELETED',
    });
    expect(users.find.mock.calls).toHaveLength(0);
  });

  it('prevents deletion of a root account', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    users.find.mockResolvedValue([
      {
        id: userId,
        roles: [{ code: 'ROOT' } as RoleEntity],
      } as UserEntity,
    ]);

    await expect(
      service.delete([userId], '00000000-0000-4000-8000-000000000999'),
    ).rejects.toMatchObject({ code: 'ROOT_USER_CANNOT_BE_DELETED' });
    expect(dataSource.transaction.mock.calls).toHaveLength(0);
  });

  it('revokes refresh tokens when an account is disabled', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const roleId = '00000000-0000-4000-8000-000000000010';
    const entity = {
      id: userId,
      username: 'operations',
      status: UserStatus.Enabled,
      refreshTokenHash: 'hash',
      roles: [],
      createdAt: new Date('2026-08-19T01:30:00Z'),
    } as unknown as UserEntity;
    users.findOne.mockResolvedValue(entity);
    roles.findBy = jest.fn().mockResolvedValue([
      {
        id: roleId,
        code: 'OPERATIONS_COORDINATOR',
        name: 'Operations Coordinator',
        isEnabled: true,
      } as RoleEntity,
    ]);
    users.save.mockResolvedValue(entity);

    await service.update(
      userId,
      {
        id: userId,
        nickname: '张伟',
        avatar: '',
        gender: 0,
        mobile: '',
        email: '',
        deptId: 3,
        roleIds: [roleId],
        status: 0,
      },
      '00000000-0000-4000-8000-000000000999',
    );

    expect(users.save.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        status: UserStatus.Disabled,
        refreshTokenHash: null,
      }),
    );
  });
});
