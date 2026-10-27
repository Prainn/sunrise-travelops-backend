import {
  isFullAdministrator,
  SUNRISE_DENIED_PERMISSIONS,
} from './account-access';
import {
  PERMISSION_DEFINITIONS,
  ADMIN_PERMISSIONS,
  BUSINESS_GROUP_PERMISSIONS,
  LEDGER_PERMISSIONS,
  INQUIRY_PERMISSIONS,
  RESOURCE_PERMISSIONS,
  TOUR_PERMISSIONS,
  WEBSITE_PERMISSIONS,
} from './permissions';
import type { CoordinatorDuty } from '../users/coordinator-assignment';
import { LoginScope } from '../users/user-identity.entity';
const userPermissions = ADMIN_PERMISSIONS.filter((p) =>
  p.startsWith('sys:user:'),
);
const reads = [
  ...ADMIN_PERMISSIONS.filter(
    (p) => p.endsWith(':list') && p !== 'sys:operation-log:list',
  ),
  'itinerary:download',
  'tour:list',
  'tour:rating:list',
];
export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  ROOT: [
    'sys:account-link:manage',
    'sys:menu-permission:list',
    'sys:menu-permission:update',
    ...ADMIN_PERMISSIONS,
    'inquiry:transfer',
    'itinerary:download',
    ...TOUR_PERMISSIONS,
  ],
  EXECUTIVE: reads,
  ADMIN: [
    'sys:account-link:manage',
    ...ADMIN_PERMISSIONS.filter(
      (p) => !p.startsWith('inquiry:') && !p.startsWith('itinerary:'),
    ),
    'inquiry:list',
    'itinerary:list',
    'itinerary:download',
    'tour:list',
    'tour:rating:list',
  ],
  BUSINESS_MANAGER: [
    'sys:business-dictionary:list',
    ...INQUIRY_PERMISSIONS,
    ...RESOURCE_PERMISSIONS,
    ...userPermissions,
    'inquiry:archive',
    'inquiry:transfer',
    'itinerary:download',
    ...TOUR_PERMISSIONS,
  ],
  COORDINATOR: [
    'sys:business-dictionary:list',
    ...INQUIRY_PERMISSIONS,
    'itinerary:download',
    'tour:list',
    'tour:rating:list',
    'tour:rating:update',
  ],
  RESOURCE_MANAGER: ['sys:business-dictionary:list', ...RESOURCE_PERMISSIONS],
};

const websiteReads = [
  'website:inquiry:list',
  'website:itinerary:list',
  'website:itinerary:download',
  'website:config:list',
];
const websiteCoordinatorPermissions = [
  ...websiteReads,
  'website:inquiry:create',
  'website:inquiry:update',
  'website:itinerary:create',
  'website:itinerary:update',
  'website:itinerary:confirm',
];
const WEBSITE_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  ROOT: WEBSITE_PERMISSIONS,
  ADMIN: [...websiteReads, 'website:config:update'],
  EXECUTIVE: websiteReads,
  BUSINESS_MANAGER: [
    ...websiteCoordinatorPermissions,
    'website:inquiry:transfer',
    'website:inquiry:archive',
  ],
  COORDINATOR: websiteCoordinatorPermissions,
  RESOURCE_MANAGER: ['website:config:list', 'website:config:update'],
};

export function effectivePermissions(
  scope: LoginScope,
  roles: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 分工仍由身份调用方传入，成团表权限已统一为计调只读。
  _coordinatorDuty: CoordinatorDuty | null = null,
): string[] {
  const summaryPermissions = (
    scope === 'headquarters'
      ? roles.some((role) => ['ROOT', 'ADMIN', 'EXECUTIVE'].includes(role))
      : roles.some((role) =>
          ['BUSINESS_MANAGER', 'COORDINATOR', 'RESOURCE_MANAGER'].includes(
            role,
          ),
        )
  )
    ? ['ledger:summary:list']
    : [];
  const visitPermissions =
    (scope === 'website' &&
      roles.some((role) =>
        ['BUSINESS_MANAGER', 'COORDINATOR'].includes(role),
      )) ||
    (scope === 'headquarters' &&
      roles.some((role) => ['ROOT', 'ADMIN', 'EXECUTIVE'].includes(role)))
      ? ['website:visit:list', 'website:visit:export']
      : [];
  const ledgerPermissions =
    scope === 'headquarters'
      ? roles.some((role) => ['ROOT', 'ADMIN', 'EXECUTIVE'].includes(role))
        ? LEDGER_PERMISSIONS.filter(
            (p) =>
              p.endsWith(':list') ||
              (roles.includes('ROOT') && p.endsWith(':create')),
          )
        : []
      : roles.some((role) => ['BUSINESS_MANAGER', 'COORDINATOR'].includes(role))
        ? LEDGER_PERMISSIONS.filter(
            (p) =>
              p.startsWith(
                scope === 'shengxu' ? 'ledger:shengxu:' : 'ledger:direct:',
              ) &&
              (!p.endsWith(':review') || roles.includes('BUSINESS_MANAGER')),
          )
        : [];
  const allowedRoles =
    scope === 'headquarters'
      ? ['ROOT', 'ADMIN', 'EXECUTIVE']
      : ['BUSINESS_MANAGER', 'COORDINATOR', 'RESOURCE_MANAGER'];
  const selected = roles.filter((role) => allowedRoles.includes(role));
  if (scope === 'headquarters' && selected.includes('ROOT'))
    return [
      ...ROLE_PERMISSIONS.ROOT,
      ...WEBSITE_ROLE_PERMISSIONS.ROOT,
      ...summaryPermissions,
      ...ledgerPermissions,
      ...visitPermissions,
    ];
  if (scope === 'headquarters' && selected.includes('EXECUTIVE'))
    return [
      ...reads,
      ...websiteReads,
      ...summaryPermissions,
      ...ledgerPermissions,
      ...visitPermissions,
    ];
  return [
    ...summaryPermissions,
    ...ledgerPermissions,
    ...visitPermissions,
    ...(scope === 'linxi' && selected.includes('BUSINESS_MANAGER')
      ? BUSINESS_GROUP_PERMISSIONS
      : []),
    ...new Set(
      selected.flatMap((role) => [
        ...(ROLE_PERMISSIONS[role] ?? []),
        ...(scope === 'website' || scope === 'linxi' || scope === 'headquarters'
          ? (WEBSITE_ROLE_PERMISSIONS[role] ?? [])
          : []),
      ]),
    ),
  ]
    .filter((permission) => {
      if (
        ['linxi', 'website'].includes(scope) &&
        permission.startsWith('resource:agency:')
      )
        return false;
      return true;
    })
    .sort();
}

/** Account restrictions are recomputed for every authenticated request. */
export function effectiveAccountPermissions(
  scope: LoginScope,
  roles: string[],
  coordinatorDuty: CoordinatorDuty | null,
  username: string,
): string[] {
  if (isFullAdministrator({ scope, roles, username }))
    return Object.keys(PERMISSION_DEFINITIONS).sort();
  const permissions = effectivePermissions(scope, roles, coordinatorDuty);
  return username === 'sunrise'
    ? permissions.filter((p) => !SUNRISE_DENIED_PERMISSIONS.includes(p))
    : permissions;
}
