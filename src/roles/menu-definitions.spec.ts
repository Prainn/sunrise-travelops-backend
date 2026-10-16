import { DataSource } from 'typeorm';
import { allowedMenuKeys, roleMenuKeys } from './menu-definitions';
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
