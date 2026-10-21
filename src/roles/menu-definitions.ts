import { effectivePermissions } from '../auth/identity-permissions';
import { LoginScope } from '../users/user-identity.entity';

export const MENU_ROLES = [
  'ROOT',
  'ADMIN',
  'EXECUTIVE',
  'BUSINESS_MANAGER',
  'COORDINATOR',
  'RESOURCE_MANAGER',
] as const;
export const MENU_DEFINITIONS = [
  {
    key: 'menu-permissions',
    title: 'menuPermissions',
    group: 'systemManagement',
    permissions: ['sys:menu-permission:list'],
    scopes: ['headquarters'],
  },
  {
    key: 'dict',
    title: 'systemDictionary',
    group: 'systemManagement',
    permissions: ['sys:dict:list'],
  },
  {
    key: 'business-dict',
    title: 'businessCategories',
    group: 'systemManagement',
    permissions: ['sys:business-dictionary:list'],
  },
  {
    key: 'users',
    title: 'userList',
    group: 'systemManagement',
    permissions: ['sys:user:list'],
  },
  {
    key: 'operations',
    title: 'operationLogs',
    group: 'systemManagement',
    permissions: ['sys:operation-log:list'],
  },
  {
    key: 'inquiries',
    title: 'inquiryList',
    group: 'inquiries',
    permissions: ['inquiry:list', 'website:inquiry:list'],
  },
  {
    key: 'inquiry-summary',
    title: 'inquiryLogReport',
    group: 'inquiries',
    permissions: ['inquiry:list'],
    scopes: ['headquarters', 'shengxu'],
  },
  {
    key: 'website-config',
    title: 'websiteResources',
    group: 'tourismResources',
    permissions: ['website:config:list'],
    scopes: ['headquarters', 'website'],
  },
  {
    key: 'agency',
    title: 'travelAgencies',
    group: 'tourismResources',
    permissions: ['resource:agency:list'],
  },
  {
    key: 'city',
    title: 'cities',
    group: 'tourismResources',
    permissions: ['resource:city:list'],
  },
  {
    key: 'hotel',
    title: 'hotels',
    group: 'tourismResources',
    permissions: ['resource:hotel:list'],
  },
  {
    key: 'restaurant',
    title: 'restaurants',
    group: 'tourismResources',
    permissions: ['resource:restaurant:list'],
  },
  {
    key: 'attraction',
    title: 'attractions',
    group: 'tourismResources',
    permissions: ['resource:attraction:list'],
  },
  {
    key: 'transport',
    title: 'vehicleModels',
    group: 'tourismResources',
    permissions: ['resource:transport:list'],
  },
  {
    key: 'flight',
    title: 'flights',
    group: 'tourismResources',
    permissions: ['resource:flight:list'],
  },
  {
    key: 'guide-people',
    title: 'guideList',
    group: 'guideManagement',
    permissions: ['resource:guide:list'],
  },
  {
    key: 'guide-leaves',
    title: 'guideLeaves',
    group: 'guideManagement',
    permissions: ['resource:guide:list'],
  },
  {
    key: 'guide-ratings',
    title: 'guideRatings',
    group: 'guideManagement',
    permissions: ['tour:list'],
  },
  {
    key: 'tours',
    title: 'tours',
    group: 'dataLedgers',
    permissions: ['tour:list'],
  },
  {
    key: 'shengxu-ledger',
    title: 'shengxuLedger',
    group: 'dataLedgers',
    permissions: ['ledger:shengxu:list'],
    scopes: ['headquarters', 'shengxu'],
  },
  {
    key: 'website-visits',
    title: 'websiteVisits',
    group: 'dataLedgers',
    permissions: ['website:visit:list'],
    scopes: ['headquarters', 'website'],
  },
  {
    key: 'direct-ledger',
    title: 'directLedger',
    group: 'dataLedgers',
    permissions: ['ledger:direct:list'],
    scopes: ['headquarters', 'linxi', 'website'],
  },
] as const;

export interface MenuNavigationItem {
  key: string;
  menuKey: string;
  title: string;
  routeName: string;
  scopes: LoginScope[];
  permissions: string[];
}

export interface MenuNavigationGroup {
  key: string;
  title: string;
  routeName: string;
  children: MenuNavigationItem[];
}

type MenuKey = (typeof MENU_DEFINITIONS)[number]['key'];
const ALL_SCOPES: LoginScope[] = [
  'headquarters',
  'shengxu',
  'linxi',
  'website',
];

function menuItem(
  menuKey: MenuKey,
  routeName: string,
  access?: Pick<MenuNavigationItem, 'scopes' | 'permissions'>,
): MenuNavigationItem {
  const definition = MENU_DEFINITIONS.find((menu) => menu.key === menuKey)!;
  return {
    key: routeName,
    menuKey,
    title: definition.title,
    routeName,
    scopes:
      access?.scopes ??
      ('scopes' in definition ? [...definition.scopes] : [...ALL_SCOPES]),
    permissions: access?.permissions ?? [...definition.permissions],
  };
}

/** Shared display order; node identity is distinct from the persisted grant key. */
export const MENU_GROUPS: MenuNavigationGroup[] = [
  {
    key: 'system',
    title: 'systemManagement',
    routeName: 'System',
    children: [
      menuItem('menu-permissions', 'MenuPermissions'),
      menuItem('dict', 'Dict'),
      menuItem('business-dict', 'BusinessCategory'),
      menuItem('users', 'User'),
      menuItem('operations', 'OperationLogs'),
    ],
  },
  {
    key: 'inquiries',
    title: 'inquiries',
    routeName: 'Inquiries',
    children: [
      menuItem('inquiries', 'InquiryList', {
        scopes: ['headquarters', 'shengxu'],
        permissions: ['inquiry:list'],
      }),
      menuItem('inquiry-summary', 'InquiryLogReport'),
    ],
  },
  {
    key: 'website-inquiries',
    title: 'websiteInquiries',
    routeName: 'WebsiteInquiries',
    children: [
      menuItem('inquiries', 'WebsiteInquiryList', {
        scopes: ['headquarters', 'linxi', 'website'],
        permissions: ['website:inquiry:list'],
      }),
    ],
  },
  {
    key: 'resources',
    title: 'tourismResources',
    routeName: 'TourismResources',
    children: [
      menuItem('website-config', 'WebsiteResources'),
      menuItem('agency', 'Agency'),
      menuItem('city', 'CityResource'),
      menuItem('hotel', 'Hotel'),
      menuItem('restaurant', 'Restaurant'),
      menuItem('attraction', 'Attraction'),
      menuItem('transport', 'TransportResource'),
      menuItem('flight', 'FlightResource'),
    ],
  },
  {
    key: 'guides',
    title: 'guideManagement',
    routeName: 'GuideManagement',
    children: [
      menuItem('guide-people', 'Guide'),
      menuItem('guide-leaves', 'GuideLeaves'),
      menuItem('guide-ratings', 'GuideRatings'),
    ],
  },
  {
    key: 'data-ledgers',
    title: 'dataLedgers',
    routeName: 'DataLedgers',
    children: [
      menuItem('tours', 'TourList'),
      menuItem('shengxu-ledger', 'ShengxuLedger'),
      menuItem('website-visits', 'WebsiteVisits'),
      menuItem('direct-ledger', 'DirectLedger'),
    ],
  },
];

export function allowedMenuKeys(scope: LoginScope, roles: string[]): string[] {
  const permissions = effectivePermissions(scope, roles);
  return MENU_DEFINITIONS.filter(
    (menu) =>
      (!('scopes' in menu) ||
        (menu.scopes as readonly string[]).includes(scope)) &&
      menu.permissions.some((permission) => permissions.includes(permission)),
  ).map((menu) => menu.key);
}

export function roleMenuKeys(role: string): string[] {
  const scopes: LoginScope[] = ['ROOT', 'ADMIN', 'EXECUTIVE'].includes(role)
    ? ['headquarters']
    : ['shengxu', 'linxi', 'website'];
  return [
    ...new Set(scopes.flatMap((scope) => allowedMenuKeys(scope, [role]))),
  ];
}

export function validMenuSnapshot(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MENU_DEFINITIONS.length &&
    value.every(
      (key) =>
        typeof key === 'string' &&
        MENU_DEFINITIONS.some((menu) => menu.key === key),
    ) &&
    new Set(value).size === value.length
  );
}
