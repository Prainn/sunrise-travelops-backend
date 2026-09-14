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

export class ProfileRoleResponse {
  code: string;
  name: string;
}

export class ProfileLoginResponse {
  id: string;
  time: string;
  ip: string;
  userAgent: string;
}

export class ProfileSecurityResponse {
  roles: ProfileRoleResponse[];
  permissions: ProfileRoleResponse[];
  recentLogins: ProfileLoginResponse[];
}
