import type { AuthenticatedUser } from '../auth/auth.types';

export function canDeleteInquiry(
  user: AuthenticatedUser,
  ownerId: string,
  permission: 'inquiry:delete' | 'website:inquiry:delete',
): boolean {
  if (!user.permissions.includes(permission)) return false;
  if (user.scope === 'headquarters') return user.roles.includes('ROOT');
  if (user.roles.includes('BUSINESS_MANAGER')) return true;
  return user.roles.includes('COORDINATOR') && ownerId === user.id;
}
