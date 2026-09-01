export interface AuthenticatedUser {
  id: string;
  username: string;
  permissions: string[];
}

export interface JwtPayload {
  sub: string;
  type: 'access' | 'refresh';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}
