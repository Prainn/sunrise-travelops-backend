import { LoginScope } from '../users/user-identity.entity';
export interface AuthenticatedUser {
  sessionId?: string;
  sessionVersion?: number;
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
  menuKeys: string[];
}

export interface JwtPayload {
  sid?: string;
  sv?: number;
  sub: string;
  type: 'access' | 'refresh';
  identityId: string;
  scope: LoginScope;
  menuKeys: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}
