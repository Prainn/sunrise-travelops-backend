import { effectiveAccountPermissions } from './identity-permissions';
import { sunrisePermissions } from './sunrise-menu-access';
import { MENU_DEFINITIONS, roleMenuKeys } from '../roles/menu-definitions';

describe('Sunrise menu grants', () => {
  const original = effectiveAccountPermissions(
    'headquarters',
    ['ROOT'],
    null,
    'sunrise',
  );
  const allowed = MENU_DEFINITIONS.filter(
    (menu) =>
      roleMenuKeys('ROOT').includes(menu.key) &&
      menu.permissions.some((p) => original.includes(p)),
  ).map((menu) => menu.key);
  it('preserves existing effective permissions until a switch is changed', () => {
    expect(sunrisePermissions(original, allowed)).toEqual(original);
  });
  it('removes all feature permissions when all menus are disabled', () => {
    expect(sunrisePermissions(original, [])).toEqual([]);
  });
  it('does not grant previously denied actions when all menus are selected', () => {
    expect(sunrisePermissions(['inquiry:list'], allowed)).toEqual([
      'inquiry:list',
    ]);
  });
});
