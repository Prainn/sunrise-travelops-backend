import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { In, Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './auth.types';
import { UserLoginRecordEntity } from './user-login-record.entity';
import { UserEntity } from '../users/user.entity';
import { PermissionEntity } from '../roles/permission.entity';

const actor = {
  id: 'account',
  identityId: 'business-identity',
  roles: ['RESOURCE_MANAGER', 'COORDINATOR', 'ADMIN'],
  permissions: ['resource:hotel:list', 'inquiry:list', 'inquiry:list'],
} as AuthenticatedUser;

describe('current identity profile security', () => {
  function setup() {
    const manager = {
      findOneOrFail: jest.fn().mockResolvedValue({
        roles: [
          { code: 'RESOURCE_MANAGER', name: '资源管理员', isEnabled: true },
          { code: 'ADMIN', name: '系统管理部', isEnabled: false },
          { code: 'ROOT', name: '超级管理员', isEnabled: true },
          { code: 'COORDINATOR', name: '计调', isEnabled: true },
        ],
      }),
      find: jest.fn().mockResolvedValue([
        { id: 'p1', code: 'inquiry:list', name: '查看询盘' },
        { id: 'p2', code: 'resource:hotel:list', name: '查看酒店' },
      ]),
    };
    const users = {
      findOne: jest.fn().mockResolvedValue({ id: actor.id }),
      manager,
    };
    const records = { find: jest.fn().mockResolvedValue([]) };
    const service = new AuthService(
      users as unknown as Repository<UserEntity>,
      {} as JwtService,
      {} as ConfigService,
      records as unknown as Repository<UserLoginRecordEntity>,
    );
    return { service, users, manager };
  }
  it('uses database names and sorted enabled roles from the current identity', async () => {
    const { service, manager } = setup();
    const result = await service.getProfileSecurity(actor);
    expect(result.roles).toEqual([
      { code: 'COORDINATOR', name: '计调' },
      { code: 'RESOURCE_MANAGER', name: '资源管理员' },
    ]);
    expect(result.permissions).toEqual([
      { code: 'inquiry:list', name: '查看询盘' },
      { code: 'resource:hotel:list', name: '查看酒店' },
    ]);
    expect(manager.find).toHaveBeenCalledWith(PermissionEntity, {
      where: { code: In(['resource:hotel:list', 'inquiry:list']) },
      order: { code: 'ASC' },
    });
    expect(manager.findOneOrFail).toHaveBeenCalledWith(expect.anything(), {
      where: { id: actor.identityId },
      relations: { roles: true },
    });
  });
  it('returns an empty list without inventing permission names', async () => {
    const { service, manager } = setup();
    manager.find.mockResolvedValue([]);
    expect(
      (await service.getProfileSecurity({ ...actor, permissions: [] }))
        .permissions,
    ).toEqual([]);
  });
  it('rejects an unavailable account before reading permissions', async () => {
    const { service, users, manager } = setup();
    users.findOne.mockResolvedValue(null);
    await expect(service.getProfileSecurity(actor)).rejects.toMatchObject({
      status: 401,
    });
    expect(manager.find).not.toHaveBeenCalled();
  });
});
