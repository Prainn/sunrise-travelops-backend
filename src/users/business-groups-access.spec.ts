import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { effectivePermissions } from '../auth/identity-permissions';
import { MenuPermissionsService } from '../roles/menu-permissions.service';
import { LoginScope } from './user-identity.entity';
import {
  assertBusinessGroupAccess,
  BusinessGroupsService,
} from './business-groups.service';

const groupPermissions = ['list', 'create', 'update'].map(
  (action) => `sys:business-group:${action}`,
);
const actor = (scope: LoginScope, roles: string[]): AuthenticatedUser => ({
  id: 'actor',
  username: 'actor',
  nickname: 'actor',
  identityId: 'identity',
  scope,
  scopeName: scope,
  deptId: null,
  deptName: '',
  roles,
  menuKeys: ['business-groups'],
  permissions: effectivePermissions(scope, roles),
});
const visible = (user: AuthenticatedUser) =>
  new MenuPermissionsService({} as DataSource)
    .navigation(user)
    .groups.flatMap((group) => group.children)
    .some((item) => item.menuKey === 'business-groups');

describe('business group access', () => {
  it.each(['COORDINATOR', 'RESOURCE_MANAGER'])(
    'rejects Linxi %s even with stale menu and permission grants before any database access',
    async (role) => {
      const user = { ...actor('linxi', [role]), permissions: groupPermissions };
      expect(visible(user)).toBe(false);
      const query = jest.fn();
      const transaction = jest.fn();
      const service = new BusinessGroupsService({
        query,
        transaction,
      } as unknown as DataSource);
      const forbidden = { code: 'AUTH_FORBIDDEN', status: 403 };
      await expect(
        service.list({ page: 1, pageSize: 20 }, user),
      ).rejects.toMatchObject(forbidden);
      await expect(service.get('group', user)).rejects.toMatchObject(forbidden);
      await expect(
        service.create({ name: 'group' }, user),
      ).rejects.toMatchObject(forbidden);
      await expect(
        service.update(
          'group',
          { name: 'group', status: 'enabled', version: 1 },
          user,
        ),
      ).rejects.toMatchObject(forbidden);
      expect(query).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['shengxu', 'website'] as const)(
    'rejects %s managers with stale grants',
    (scope) => {
      const user = {
        ...actor(scope, ['BUSINESS_MANAGER']),
        permissions: groupPermissions,
      };
      expect(visible(user)).toBe(false);
      expect(() => assertBusinessGroupAccess(user, 'list')).toThrow();
    },
  );

  it.each([
    { scope: 'linxi' as const, roles: ['BUSINESS_MANAGER'], writable: true },
    { scope: 'headquarters' as const, roles: ['ROOT'], writable: true },
    { scope: 'headquarters' as const, roles: ['ADMIN'], writable: true },
    { scope: 'headquarters' as const, roles: ['EXECUTIVE'], writable: false },
    {
      scope: 'headquarters' as const,
      roles: ['EXECUTIVE', 'ADMIN'],
      writable: false,
    },
  ])('preserves $scope/$roles grants', ({ scope, roles, writable }) => {
    const user = actor(scope, roles);
    expect(visible(user)).toBe(true);
    expect(() => assertBusinessGroupAccess(user, 'list')).not.toThrow();
    for (const action of ['create', 'update'] as const) {
      if (writable)
        expect(() => assertBusinessGroupAccess(user, action)).not.toThrow();
      else expect(() => assertBusinessGroupAccess(user, action)).toThrow();
    }
  });

  it('still requires list permission and menu grant for the Linxi manager', () => {
    const user = actor('linxi', ['BUSINESS_MANAGER']);
    expect(visible({ ...user, permissions: [] })).toBe(false);
    expect(visible({ ...user, menuKeys: [] })).toBe(false);
    expect(() =>
      assertBusinessGroupAccess({ ...user, permissions: [] }, 'list'),
    ).toThrow();
  });
});
