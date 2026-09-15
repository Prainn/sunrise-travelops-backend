import { DataSource, EntityManager, Repository } from 'typeorm';
import { RoleEntity } from '../roles/role.entity';
import { AuthenticatedUser } from '../auth/auth.types';
import { UserEntity, UserStatus } from './user.entity';
import { UserIdentityEntity } from './user-identity.entity';
import { UserManagementService } from './user-management.service';
const actor = {
  id: '00000000-0000-4000-8000-000000000999',
  scope: 'headquarters',
} as AuthenticatedUser;
const role = {
  id: '00000000-0000-4000-8000-000000000010',
  code: 'COORDINATOR',
  isEnabled: true,
} as RoleEntity;
describe('UserManagementService', () => {
  function setup(user: UserEntity | null, unfinished = 0) {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(user),
    };
    const manager = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      findOne: jest.fn().mockResolvedValue(user),
      findBy: jest.fn().mockResolvedValue([role]),
      query: jest.fn().mockResolvedValue([{ total: 1, unfinished }]),
      save: jest
        .fn()
        .mockImplementation((...values: unknown[]) =>
          Promise.resolve(values.at(-1)),
        ),
      create: jest.fn((_entity: unknown, value: unknown) => value),
      delete: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    const transaction = jest.fn((fn: (manager: EntityManager) => unknown) =>
      fn(manager as unknown as EntityManager),
    );
    const service = new UserManagementService(
      {} as Repository<UserEntity>,
      {} as Repository<RoleEntity>,
      { manager, transaction } as unknown as DataSource,
    );
    return { service, manager, qb, transaction };
  }
  function user() {
    return Object.assign(new UserEntity(), {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'operations',
      status: UserStatus.Enabled,
      createdAt: new Date('2026-08-19T01:30:00Z'),
      identities: [
        Object.assign(new UserIdentityEntity(), {
          id: '00000000-0000-4000-8000-000000000020',
          scope: 'shengxu',
          deptId: 3,
          roles: [role],
          refreshTokenHash: 'hash',
        }),
      ],
    });
  }
  const input = {
    nickname: '张伟',
    avatar: '',
    gender: 0,
    mobile: '',
    email: '',
    status: 0,
    identities: [{ scope: 'shengxu' as const, deptId: 3, roleIds: [role.id] }],
  };
  it('prevents self deletion before opening a write transaction', async () => {
    const { service, transaction } = setup(null);
    await expect(service.delete([actor.id], actor)).rejects.toMatchObject({
      code: 'CURRENT_USER_CANNOT_BE_DELETED',
    });
    expect(transaction).not.toHaveBeenCalled();
  });
  it('excludes the superuser from direct account management and cannot delete a hidden account', async () => {
    const { service, qb, manager } = setup(null);
    await expect(service.delete([user().id], actor)).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
    expect(qb.where).toHaveBeenCalledWith('u.is_superuser = false');
    expect(manager.softDelete).not.toHaveBeenCalled();
  });
  it('revokes refresh tokens for every retained identity when disabling a completed owner', async () => {
    const entity = user();
    const { service, manager } = setup(entity);
    await service.update(entity.id, input, actor);
    expect(entity.status).toBe(UserStatus.Disabled);
    expect(manager.save).toHaveBeenCalledWith(
      UserIdentityEntity,
      expect.objectContaining({
        id: entity.identities[0].id,
        refreshTokenHash: null,
      }),
    );
  });
  it('prevents disabling an owner with unfinished inquiries before writing anything', async () => {
    const entity = user();
    const { service, manager } = setup(entity, 1);
    await expect(service.update(entity.id, input, actor)).rejects.toMatchObject(
      { code: 'INQUIRY_OWNER_INVALID', details: { unfinished: 1 } },
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('releases identities while retaining the deleted account for historical ownership', async () => {
    const entity = user();
    const { service, manager } = setup(entity);
    await service.delete([entity.id], actor);
    expect(manager.delete).toHaveBeenCalledTimes(1);
    expect(manager.delete).toHaveBeenCalledWith(UserIdentityEntity, {
      userId: entity.id,
    });
    expect(manager.softDelete).toHaveBeenCalledWith(UserEntity, entity.id);
  });

  it('does not release an identity when unfinished inquiries prevent deletion', async () => {
    const entity = user();
    const { service, manager } = setup(entity, 1);
    await expect(service.delete([entity.id], actor)).rejects.toMatchObject({
      code: 'INQUIRY_OWNER_INVALID',
    });
    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.softDelete).not.toHaveBeenCalled();
  });
});
