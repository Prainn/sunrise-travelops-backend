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
    key: 'menu-permissions',
    title: 'menuPermissions',
    group: 'systemManagement',
    permissions: ['sys:menu-permission:list'],
    scopes: ['headquarters'],
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
    scopes: ['headquarters', 'linxi', 'website'],
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
  { key: 'tours', title: 'tours', group: 'tours', permissions: ['tour:list'] },
] as const;

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
