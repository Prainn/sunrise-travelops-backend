import { AuthService } from './auth.service';
import { MenuPermissionsService } from '../roles/menu-permissions.service';
import { allowedMenuKeys } from '../roles/menu-definitions';

describe('read-only tour navigation', () => {
  it('keeps tour reads and ratings available when duty changes without granting tour writes', async () => {
    const identity = {
      id: 'identity',
      scope: 'linxi',
      coordinatorDuty: 'reception',
      roles: [{ code: 'COORDINATOR', isEnabled: true }],
      user: {
        id: 'user',
        status: 'enabled',
        username: 'test',
        nickname: 'Test',
      },
    };
    const findOne = jest.fn().mockResolvedValue(identity);
    const args = [
      { manager: { findOne, query: jest.fn().mockResolvedValue([{}]) } },
      {},
      {},
      {},
      {},
      {},
    ] as unknown as ConstructorParameters<typeof AuthService>;
    const auth = new AuthService(...args);
    const menus = new MenuPermissionsService(
      {} as ConstructorParameters<typeof MenuPermissionsService>[0],
    );
    const snapshot = ['tours', 'guide-ratings'];
    expect(allowedMenuKeys('linxi', ['COORDINATOR'])).toEqual(
      expect.arrayContaining(snapshot),
    );
    const current = () =>
      auth.getCurrentUser('user', 'identity', 'linxi', snapshot, 'session', 1);
    const visible = async () =>
      menus
        .navigation(await current())
        .groups.flatMap((group) => group.children.map((item) => item.menuKey));
    for (const duty of ['reception', 'operation', 'both']) {
      identity.coordinatorDuty = duty;
      expect(await visible()).toEqual(['guide-ratings', 'tours']);
      const permissions = (await current()).permissions;
      expect(permissions).toContain('tour:list');
      for (const action of ['create', 'update', 'cancel']) {
        expect(permissions).not.toContain(`tour:${action}`);
      }
    }
    const latest = await current();
    expect(latest.menuKeys).toEqual(snapshot);
    expect(latest.permissions).toContain('tour:rating:update');
    expect(findOne).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        where: { id: 'identity', userId: 'user', scope: 'linxi' },
      }),
    );
  });
});
