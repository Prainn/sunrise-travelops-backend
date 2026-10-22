import { DataSource } from 'typeorm';
import { allowedMenuKeys, MENU_GROUPS, roleMenuKeys } from './menu-definitions';
import { MenuPermissionsService } from './menu-permissions.service';

describe('website configuration menu scope', () => {
  const businessRoles = ['BUSINESS_MANAGER', 'COORDINATOR', 'RESOURCE_MANAGER'];

  it.each(['ROOT', 'ADMIN', 'EXECUTIVE'])(
    'preserves website configuration for headquarters %s grants',
    (role) => {
      expect(allowedMenuKeys('headquarters', [role])).toContain(
        'website-config',
      );
      expect(roleMenuKeys(role)).toContain('website-config');
    },
  );

  it.each(businessRoles)(
    'grants the shared %s menu only in website business scope',
    (role) => {
      expect(allowedMenuKeys('website', [role])).toContain('website-config');
      expect(roleMenuKeys(role)).toContain('website-config');
      for (const scope of ['shengxu', 'linxi'] as const) {
        expect(allowedMenuKeys(scope, [role])).not.toContain('website-config');
      }
    },
  );

  it('filters stored grants when issuing snapshots, including ROOT', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ menuKeys: ['website-config', 'inquiries'] }]);
    const menus = new MenuPermissionsService({
      query,
    } as unknown as DataSource);
    expect(await menus.snapshot('website', ['COORDINATOR'])).toContain(
      'website-config',
    );
    expect(await menus.snapshot('linxi', ['COORDINATOR'])).toEqual([
      'inquiries',
    ]);
    for (const role of ['ROOT', 'ADMIN', 'EXECUTIVE']) {
      expect(await menus.snapshot('headquarters', [role])).toContain(
        'website-config',
      );
    }
    query.mockResolvedValue([]);
    expect(await menus.snapshot('website', ['COORDINATOR'])).not.toContain(
      'website-config',
    );
    expect(await menus.snapshot('headquarters', ['ADMIN'])).not.toContain(
      'website-config',
    );
    expect(await menus.snapshot('headquarters', ['ROOT'])).toContain(
      'website-config',
    );
  });
});

describe('separate direct ledger entries', () => {
  const keys = ['direct-ledger', 'website-ledger'];

  it.each(['ROOT', 'ADMIN', 'EXECUTIVE'])(
    'allows headquarters %s to access both entries',
    (role) => {
      expect(allowedMenuKeys('headquarters', [role])).toEqual(
        expect.arrayContaining(keys),
      );
    },
  );

  it.each(['BUSINESS_MANAGER', 'COORDINATOR'])(
    'restricts %s navigation by current business despite stored cross-business grants',
    async (role) => {
      const service = new MenuPermissionsService({
        query: jest.fn().mockResolvedValue([{ menuKeys: keys }]),
      } as unknown as DataSource);
      for (const [scope, key] of [
        ['linxi', 'direct-ledger'],
        ['website', 'website-ledger'],
      ] as const) {
        const snapshot = await service.snapshot(scope, [role]);
        expect(snapshot.filter((value) => keys.includes(value))).toEqual([key]);
        const navigation = service.navigation({
          scope,
          roles: [role],
          menuKeys: keys,
          permissions: ['ledger:direct:list'],
        } as Parameters<MenuPermissionsService['navigation']>[0]);
        expect(
          navigation.groups
            .flatMap((group) => group.children)
            .map((item) => item.menuKey),
        ).toEqual([key]);
      }
      expect(allowedMenuKeys('shengxu', [role])).not.toEqual(
        expect.arrayContaining(['website-ledger']),
      );
      expect(allowedMenuKeys('website', ['RESOURCE_MANAGER'])).not.toContain(
        'website-ledger',
      );
    },
  );

  it('keeps the ledger menus independently configurable and ordered', async () => {
    const service = new MenuPermissionsService({
      query: jest.fn().mockResolvedValue([{ menuKeys: ['direct-ledger'] }]),
    } as unknown as DataSource);
    expect(await service.snapshot('website', ['COORDINATOR'])).not.toContain(
      'website-ledger',
    );
    const group = MENU_GROUPS.find((item) => item.key === 'data-ledgers')!;
    expect(group.children.slice(-2).map((item) => item.routeName)).toEqual([
      'DirectLedger',
      'WebsiteLedger',
    ]);
  });
});
