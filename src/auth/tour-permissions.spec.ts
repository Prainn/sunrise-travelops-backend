import { AuthService } from './auth.service';
import { MenuPermissionsService } from '../roles/menu-permissions.service';
import { allowedMenuKeys } from '../roles/menu-definitions';

describe('live tour duty and navigation', () => {
  it('reads changed duty on each request while preserving the menu snapshot and rating access', async () => {
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
      { manager: { findOne } },
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
      auth.getCurrentUser('user', 'identity', 'linxi', snapshot);
    const visible = async () =>
      menus
        .navigation(await current())
        .groups.flatMap((group) => group.children.map((item) => item.menuKey));
    expect(await visible()).toEqual(['guide-ratings']);
    identity.coordinatorDuty = 'operation';
    expect(await visible()).toEqual(['guide-ratings', 'tours']);
    expect((await current()).permissions).not.toContain('tour:create');
    identity.coordinatorDuty = 'reception';
    expect(await visible()).toEqual(['guide-ratings']);
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
