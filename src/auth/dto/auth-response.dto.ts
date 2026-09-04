export class AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export class AuthenticatedUserResponse {
  id: string;
  username: string;
  permissions: string[];
}
