import { FeishuService } from '../feishu/feishu.service';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { RoleEntity } from '../roles/role.entity';
import { UserEntity } from './user.entity';
import { UserManagementService } from './user-management.service';
import { UserIdentityEntity, LoginScope } from './user-identity.entity';
import { CoordinatorDuty } from './coordinator-assignment';
import { CreateUserDto, UpdateUserDto } from './dto/user-management.dto';

jest.mock('argon2', () => ({ hash: jest.fn().mockResolvedValue('test-hash') }));

describe('UserManagementService.response', () => {
  it.each([
    {
      label: 'sorts by role code',
      roles: [
        { id: 'a', code: 'RESOURCE_MANAGER', name: '资源管理员' },
        { id: 'z', code: 'COORDINATOR', name: '计调' },
      ],
      roleIds: ['z', 'a'],
      roleNames: '计调,资源管理员',
    },
    {
      label: 'breaks equal role code ties by role id',
      roles: [
        { id: 'b', code: 'COORDINATOR', name: '计调乙' },
        { id: 'a', code: 'COORDINATOR', name: '计调甲' },
      ],
      roleIds: ['a', 'b'],
      roleNames: '计调甲,计调乙',
    },
  ])('$label regardless of input order', ({ roles, roleIds, roleNames }) => {
    const service = new UserManagementService(
      {} as Repository<UserEntity>,
      {} as Repository<RoleEntity>,
      {} as DataSource,
      new FeishuService(new ConfigService({})),
    );
    const user = {
      id: 'user',
      createdAt: new Date('2026-10-23T00:00:00Z'),
      identities: [{ id: 'identity', roles }],
    } as UserEntity;

    const inputRoleIds = roles.map((role) => role.id);
    const first = service['response'](user);
    expect(first.identities[0]).toMatchObject({ roleIds, roleNames });
    expect(user.identities[0].roles.map((role) => role.id)).toEqual(
      inputRoleIds,
    );

    user.identities[0].roles = [...user.identities[0].roles].reverse();
    expect(service['response'](user)).toEqual(first);
  });
});

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
      new FeishuService(new ConfigService({})),
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

describe('UserManagementService coordinator duty by business', () => {
  const actor = {
    id: 'actor',
    scope: 'headquarters',
    roles: ['ROOT'],
    permissions: ['sys:user:update'],
  } as AuthenticatedUser;

  function setup(scope: LoginScope, duty: CoordinatorDuty | null) {
    const role = {
      id: 'role',
      code: 'COORDINATOR',
      isEnabled: true,
    } as RoleEntity;
    const identity = {
      id: 'identity',
      scope,
      roles: [role],
      coordinatorDuty: duty,
      deptId: { headquarters: 1, shengxu: 3, linxi: 5, website: 7 }[scope],
      businessGroupId: scope === 'linxi' ? 'group' : null,
    } as UserIdentityEntity;
    const target = {
      id: 'target',
      version: 1,
      username: 'test',
      createdAt: new Date(),
      identities: [identity],
    } as UserEntity;
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(target),
    };
    const manager = {
      findOne: jest.fn().mockResolvedValue(target),
      findBy: jest.fn().mockResolvedValue([role]),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      query: jest.fn().mockResolvedValue([{ exists: false }]),
      create: jest.fn((_entity: unknown, values: object) => values),
      save: jest.fn().mockResolvedValue(target),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const db = {
      manager,
      transaction: (work: (value: typeof manager) => Promise<unknown>) =>
        work(manager),
    } as unknown as DataSource;
    const service = new UserManagementService(
      {} as Repository<UserEntity>,
      {} as Repository<RoleEntity>,
      db,
      new FeishuService(new ConfigService({})),
    );
    const input = Object.assign(new UpdateUserDto(), {
      nickname: 'Test',
      englishName: 'Test',
      tourCode: 'TT',
      status: 1,
      identities: [
        {
          id: identity.id,
          scope,
          deptId: identity.deptId,
          roleIds: [role.id],
          businessGroupId: identity.businessGroupId,
        },
      ],
    });
    return { service, manager, target, input };
  }

  it('creates Shengxu coordinators without a duty', async () => {
    const { service, manager, input } = setup('shengxu', null);
    await service.create(
      Object.assign(new CreateUserDto(), input, {
        username: 'test',
        password: 'test-password',
      }),
      actor,
    );
    expect(manager.save).toHaveBeenCalledWith(
      UserIdentityEntity,
      expect.objectContaining({ coordinatorDuty: null }),
    );
  });

  it.each(['reception', 'operation', 'both', null] as const)(
    'preserves unused Shengxu historical duty %s during account edits',
    async (duty) => {
      const { service, manager, input } = setup('shengxu', duty);
      await service.update('target', input, actor);
      expect(manager.save).toHaveBeenCalledWith(
        UserIdentityEntity,
        expect.objectContaining({ coordinatorDuty: duty }),
      );
    },
  );

  it('rejects a Shengxu duty update before modifying the identity', async () => {
    const { service, manager } = setup('shengxu', 'reception');
    await expect(
      service.updateCoordinatorDuty(
        'target',
        { version: 1, coordinatorDuty: 'operation' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('rejects explicit Shengxu duty in a full account edit', async () => {
    const { service, input } = setup('shengxu', 'reception');
    input.identities[0].coordinatorDuty = 'operation';
    await expect(service.update('target', input, actor)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it.each(['linxi', 'website'] as const)(
    'retains duty editing for %s',
    async (scope) => {
      const { service, manager, input } = setup(scope, 'reception');
      input.identities[0].coordinatorDuty = 'operation';
      await service.update('target', input, actor);
      expect(manager.save).toHaveBeenCalledWith(
        UserIdentityEntity,
        expect.objectContaining({ coordinatorDuty: 'operation' }),
      );
      await service.updateCoordinatorDuty(
        'target',
        { version: 1, coordinatorDuty: 'both' },
        actor,
      );
      expect(manager.update).toHaveBeenCalledWith(
        UserIdentityEntity,
        'identity',
        { coordinatorDuty: 'both' },
      );
    },
  );
});
