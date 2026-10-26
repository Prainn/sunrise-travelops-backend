import { effectivePermissions } from './identity-permissions';
import { PERMISSION_DEFINITIONS, TOUR_PERMISSIONS } from './permissions';

describe('headquarters permissions', () => {
  it('grants ROOT existing operations and ledger creation', () => {
    const permissions = effectivePermissions('headquarters', ['ROOT']);
    expect(permissions).toEqual(
      expect.arrayContaining(
        Object.keys(PERMISSION_DEFINITIONS).filter(
          (p) =>
            !p.startsWith('ledger:') ||
            p.endsWith(':list') ||
            p.endsWith(':create'),
        ),
      ),
    );
  });

  it.each(['ADMIN', 'EXECUTIVE'])('%s can only read tours', (role) => {
    const permissions = effectivePermissions('headquarters', [role]);
    expect(permissions).toContain('tour:list');
    for (const permission of TOUR_PERMISSIONS.filter(
      (p) => !p.endsWith(':list'),
    )) {
      expect(permissions).not.toContain(permission);
    }
  });

  it.each([['EXECUTIVE'], ['ADMIN'], ['EXECUTIVE', 'ADMIN']])(
    'keeps inquiry and itinerary operations read-only for %j',
    (...roles: string[]) => {
      const permissions = effectivePermissions('headquarters', roles);
      expect(permissions).toEqual(
        expect.arrayContaining([
          'inquiry:list',
          'itinerary:list',
          'itinerary:download',
        ]),
      );
      expect(
        permissions.filter(
          (p) =>
            (p.startsWith('inquiry:') || p.startsWith('itinerary:')) &&
            !['inquiry:list', 'itinerary:list', 'itinerary:download'].includes(
              p,
            ),
        ),
      ).toEqual([]);
    },
  );
});

const websitePermissions = (
  scope: Parameters<typeof effectivePermissions>[0],
  roles: string[],
) =>
  effectivePermissions(scope, roles).filter(
    (code) => code.startsWith('website:') && !code.startsWith('website:visit:'),
  );

describe('independent website permissions', () => {
  it.each(['shengxu'] as const)(
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

it('linxi roles receive the same website function grants without gaining role-menu management', () => {
  for (const role of ['COORDINATOR', 'BUSINESS_MANAGER', 'RESOURCE_MANAGER']) {
    expect(websitePermissions('linxi', [role])).toEqual(
      websitePermissions('website', [role]),
    );
    expect(effectivePermissions('linxi', [role])).not.toContain(
      'sys:menu-permission:update',
    );
  }
});

describe('ledger permissions', () => {
  it.each([['ROOT'], ['ROOT', 'ADMIN'], ['ROOT', 'EXECUTIVE']])(
    'only grants headquarters ROOT ledger reads and creation for %j',
    (...roles: string[]) => {
      expect(
        effectivePermissions('headquarters', roles)
          .filter((p) => p.startsWith('ledger:'))
          .sort(),
      ).toEqual([
        'ledger:direct:create',
        'ledger:direct:list',
        'ledger:shengxu:create',
        'ledger:shengxu:list',
        'ledger:summary:list',
      ]);
    },
  );
  it.each(['ADMIN', 'EXECUTIVE'])('headquarters %s is read-only', (role) => {
    expect(
      effectivePermissions('headquarters', [role])
        .filter((p) => p.startsWith('ledger:'))
        .sort(),
    ).toEqual([
      'ledger:direct:list',
      'ledger:shengxu:list',
      'ledger:summary:list',
    ]);
  });
  it.each(['shengxu', 'linxi', 'website'] as const)(
    'isolates business permissions for %s',
    (scope) => {
      const prefix = scope === 'shengxu' ? 'ledger:shengxu:' : 'ledger:direct:';
      const permissions = effectivePermissions(scope, ['COORDINATOR']).filter(
        (p) => p.startsWith('ledger:'),
      );
      expect(permissions).toContain('ledger:summary:list');
      const businessPermissions = permissions.filter(
        (p) => p !== 'ledger:summary:list',
      );
      expect(businessPermissions.length).toBeGreaterThan(0);
      expect(businessPermissions.every((p) => p.startsWith(prefix))).toBe(true);
      expect(permissions).not.toContain('ledger:direct:review');
      expect(
        effectivePermissions(scope, ['RESOURCE_MANAGER']).filter((p) =>
          p.startsWith('ledger:'),
        ),
      ).toEqual(['ledger:summary:list']);
    },
  );
});

describe('read-only coordinator tour permissions', () => {
  it.each(['shengxu', 'linxi', 'website'] as const)(
    '%s allows tour reads and independent ratings for every duty',
    (scope) => {
      for (const duty of ['reception', 'operation', 'both', null] as const) {
        const permissions = effectivePermissions(scope, ['COORDINATOR'], duty);
        expect(permissions).toContain('tour:list');
        for (const action of ['create', 'update', 'cancel']) {
          expect(permissions).not.toContain(`tour:${action}`);
        }
        expect(permissions).toEqual(
          expect.arrayContaining(['tour:rating:list', 'tour:rating:update']),
        );
        for (const roles of [
          ['BUSINESS_MANAGER'],
          ['BUSINESS_MANAGER', 'COORDINATOR'],
        ]) {
          expect(effectivePermissions(scope, roles, duty)).toEqual(
            expect.arrayContaining([...TOUR_PERMISSIONS]),
          );
        }
      }
    },
  );
});

describe('retired grants', () => {
  it('does not expose unused role CRUD or user import/export to any identity', () => {
    const retired = [
      'sys:role:list',
      'sys:role:create',
      'sys:role:update',
      'sys:role:delete',
      'sys:user:import',
      'sys:user:export',
    ];
    for (const scope of [
      'headquarters',
      'shengxu',
      'linxi',
      'website',
    ] as const) {
      for (const role of [
        'ROOT',
        'ADMIN',
        'EXECUTIVE',
        'BUSINESS_MANAGER',
        'COORDINATOR',
        'RESOURCE_MANAGER',
      ]) {
        for (const code of retired) {
          expect(PERMISSION_DEFINITIONS).not.toHaveProperty(code);
          expect(effectivePermissions(scope, [role])).not.toContain(code);
        }
      }
    }
  });
});
