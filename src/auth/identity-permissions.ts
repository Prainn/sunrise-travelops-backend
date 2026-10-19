import {
  ADMIN_PERMISSIONS,
  LEDGER_PERMISSIONS,
  INQUIRY_PERMISSIONS,
  RESOURCE_PERMISSIONS,
  TOUR_PERMISSIONS,
  WEBSITE_PERMISSIONS,
} from './permissions';
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
];
export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  ROOT: [
    'sys:menu-permission:list',
    'sys:menu-permission:update',
    ...ADMIN_PERMISSIONS,
    'inquiry:transfer',
    'itinerary:download',
    ...TOUR_PERMISSIONS,
  ],
  EXECUTIVE: reads,
  ADMIN: [
    ...ADMIN_PERMISSIONS.filter(
      (p) => !p.startsWith('inquiry:') && !p.startsWith('itinerary:'),
    ),
    'inquiry:list',
    'itinerary:list',
    'itinerary:download',
    'tour:list',
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
    ...TOUR_PERMISSIONS,
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
): string[] {
  const ledgerPermissions =
    scope === 'headquarters'
      ? roles.some((role) => ['ROOT', 'ADMIN', 'EXECUTIVE'].includes(role))
        ? LEDGER_PERMISSIONS.filter((p) => p.endsWith(':list'))
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
      ...ledgerPermissions,
    ];
  if (scope === 'headquarters' && selected.includes('EXECUTIVE'))
    return [...reads, ...websiteReads, ...ledgerPermissions];
  return [
    ...ledgerPermissions,
    ...new Set(
      selected.flatMap((role) => [
        ...(ROLE_PERMISSIONS[role] ?? []),
        ...(scope === 'website' || scope === 'linxi' || scope === 'headquarters'
          ? (WEBSITE_ROLE_PERMISSIONS[role] ?? [])
          : []),
      ]),
    ),
  ].sort();
}
