import { LoginScope, ResourceLibrary } from '../users/user-identity.entity';
export interface AuthenticatedUser {
  id: string;
  username: string;
  permissions: string[];
  nickname: string;
  identityId: string;
  scope: LoginScope;
  scopeName: string;
  deptId: number | null;
  deptName: string;
  roles: string[];
  resourceLibrary: ResourceLibrary | null;
}

export interface JwtPayload {
  sub: string;
  type: 'access' | 'refresh';
  identityId: string;
  scope: LoginScope;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}
