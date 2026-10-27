import type { AuthenticatedUser } from './auth.types';

export const RESERVED_USERNAMES = ['sunrise', 'mango'];

/** Reserved account privileges require the enabled headquarters ROOT identity. */
export function isFullAdministrator(
  actor: Pick<AuthenticatedUser, 'username' | 'scope' | 'roles'>,
): boolean {
  return (
    actor.username === 'mango' &&
    actor.scope === 'headquarters' &&
    actor.roles.includes('ROOT')
  );
}

export const SUNRISE_DENIED_PERMISSIONS = [
  'website:visit:list',
  'website:visit:export',
  'sys:menu-permission:list',
  'sys:menu-permission:update',
  'sys:account-link:manage',
  'sys:dict:create',
  'sys:dict:update',
  'sys:dict:delete',
  'sys:dict-item:create',
  'sys:dict-item:update',
  'sys:dict-item:delete',
  'sys:business-dictionary:create',
  'sys:business-dictionary:update',
  'sys:business-dictionary:delete',
];
