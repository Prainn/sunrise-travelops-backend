import { effectivePermissions } from './identity-permissions';

const websitePermissions = (
  scope: Parameters<typeof effectivePermissions>[0],
  roles: string[],
) =>
  effectivePermissions(scope, roles).filter((code) =>
    code.startsWith('website:'),
  );

describe('independent website permissions', () => {
  it.each(['shengxu', 'linxi'] as const)(
    'does not grant website permissions to %s business roles',
    (scope) => {
      expect(
        websitePermissions(scope, [
          'BUSINESS_MANAGER',
          'COORDINATOR',
          'RESOURCE_MANAGER',
          'ROOT',
        ]),
      ).toEqual([]);
      expect(effectivePermissions(scope, ['COORDINATOR'])).toContain(
        'inquiry:create',
      );
    },
  );

  it('allows website coordinators to work on quotes without managing configuration or transfers', () => {
    expect(websitePermissions('website', ['COORDINATOR'])).toEqual([
      'website:config:list',
      'website:inquiry:create',
      'website:inquiry:list',
      'website:inquiry:update',
      'website:itinerary:confirm',
      'website:itinerary:create',
      'website:itinerary:download',
      'website:itinerary:list',
      'website:itinerary:update',
    ]);
  });

  it('allows website business managers to transfer and archive without managing configuration', () => {
    const permissions = websitePermissions('website', ['BUSINESS_MANAGER']);
    expect(permissions).toEqual(
      expect.arrayContaining([
        'website:inquiry:transfer',
        'website:inquiry:archive',
        'website:itinerary:confirm',
        'website:config:list',
      ]),
    );
    expect(permissions).not.toContain('website:config:update');
  });

  it('restricts website resource managers to website configuration', () => {
    expect(websitePermissions('website', ['RESOURCE_MANAGER'])).toEqual([
      'website:config:list',
      'website:config:update',
    ]);
    expect(effectivePermissions('website', ['RESOURCE_MANAGER'])).toContain(
      'resource:hotel:update',
    );
  });

  it('allows headquarters admins to maintain configuration and read frozen quotes', () => {
    expect(websitePermissions('headquarters', ['ADMIN'])).toEqual([
      'website:config:list',
      'website:config:update',
      'website:inquiry:list',
      'website:itinerary:download',
      'website:itinerary:list',
    ]);
  });

  it.each([{ roles: ['EXECUTIVE'] }, { roles: ['EXECUTIVE', 'ADMIN'] }])(
    'keeps headquarters executive grants read-only for $roles',
    ({ roles }) => {
      expect(websitePermissions('headquarters', roles).sort()).toEqual([
        'website:config:list',
        'website:inquiry:list',
        'website:itinerary:download',
        'website:itinerary:list',
      ]);
      expect(effectivePermissions('headquarters', roles)).not.toContain(
        'inquiry:create',
      );
    },
  );

  it('allows root to operate website business and configuration', () => {
    const permissions = websitePermissions('headquarters', ['ROOT']);
    expect(permissions).toHaveLength(12);
    expect(permissions).toEqual(
      expect.arrayContaining([
        'website:inquiry:transfer',
        'website:inquiry:archive',
        'website:itinerary:confirm',
        'website:itinerary:create',
        'website:config:update',
      ]),
    );
  });
});
