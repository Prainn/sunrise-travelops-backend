import {
  ADMIN_PERMISSIONS,
  INQUIRY_PERMISSIONS,
  RESOURCE_PERMISSIONS,
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
];
export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  ROOT: [...ADMIN_PERMISSIONS, 'inquiry:transfer', 'itinerary:download'],
  EXECUTIVE: reads,
  ADMIN: [
    ...ADMIN_PERMISSIONS.filter(
      (p) => !p.startsWith('inquiry:') && !p.startsWith('itinerary:'),
    ),
    'inquiry:list',
    'itinerary:list',
    'itinerary:download',
  ],
  BUSINESS_MANAGER: [
    'sys:business-dictionary:list',
    ...INQUIRY_PERMISSIONS,
    ...RESOURCE_PERMISSIONS,
    ...userPermissions,
    'inquiry:archive',
    'inquiry:transfer',
    'itinerary:download',
  ],
  COORDINATOR: [
    'sys:business-dictionary:list',
    ...INQUIRY_PERMISSIONS,
    'itinerary:download',
  ],
  RESOURCE_MANAGER: ['sys:business-dictionary:list', ...RESOURCE_PERMISSIONS],
};
export function effectivePermissions(
  scope: LoginScope,
  roles: string[],
): string[] {
  const allowedRoles =
    scope === 'headquarters'
      ? ['ROOT', 'ADMIN', 'EXECUTIVE']
      : ['BUSINESS_MANAGER', 'COORDINATOR', 'RESOURCE_MANAGER'];
  const selected = roles.filter((role) => allowedRoles.includes(role));
  if (scope === 'headquarters' && selected.includes('ROOT'))
    return [...ROLE_PERMISSIONS.ROOT];
  if (scope === 'headquarters' && selected.includes('EXECUTIVE'))
    return [...reads];
  return [
    ...new Set(selected.flatMap((role) => ROLE_PERMISSIONS[role] ?? [])),
  ].sort();
}
