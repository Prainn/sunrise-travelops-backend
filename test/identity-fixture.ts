import { UserEntity } from '../src/users/user.entity';
import { AuthenticatedUser } from '../src/auth/auth.types';
import { effectivePermissions } from '../src/auth/identity-permissions';
import {
  libraryFor,
  SCOPE_NAMES,
  LoginScope,
} from '../src/users/user-identity.entity';
export function fixtureIdentity(
  user: UserEntity,
  scope: LoginScope,
): AuthenticatedUser {
  const identity = user.identities.find((i) => i.scope === scope);
  if (!identity)
    throw new Error(`Missing ${scope} identity for fixture ${user.id}`);
  const roles = identity.roles.filter((r) => r.isEnabled).map((r) => r.code);
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    identityId: identity.id,
    scope,
    scopeName: SCOPE_NAMES[scope],
    deptId: identity.deptId,
    deptName: '',
    roles,
    permissions: effectivePermissions(scope, roles),
    resourceLibrary: scope === 'headquarters' ? null : libraryFor(scope),
  };
}
