import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  UserIdentityEntity,
  LoginScope,
  SCOPE_NAMES,
  libraryFor,
} from '../users/user-identity.entity';
import { effectivePermissions } from './identity-permissions';
import { UserLoginRecordEntity } from './user-login-record.entity';
import { DEPARTMENT_OPTIONS } from '../users/user-management.constants';
import {
  UserProfileResponse,
  ProfileSecurityResponse,
} from './dto/auth-response.dto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { In, Repository } from 'typeorm';
import { PermissionEntity } from '../roles/permission.entity';
import { ErrorCode } from '../common/constants/error-code';
import { BusinessException } from '../common/exceptions/business.exception';
import { UserEntity, UserStatus } from '../users/user.entity';
import { AuthenticatedUser, AuthTokens, JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(UserLoginRecordEntity)
    private readonly loginRecords: Repository<UserLoginRecordEntity>,
  ) {}

  async login(
    username: string,
    password: string,
    client: { ip: string; userAgent: string },
    scope: LoginScope,
  ): Promise<AuthTokens> {
    const identity = await this.users.manager.findOne(UserIdentityEntity, {
      where: { username, scope },
      relations: { user: true, roles: true },
    });
    const user = identity?.user;
    if (
      !user ||
      user.deletedAt ||
      user.status !== UserStatus.Enabled ||
      !identity?.roles.some((r) => r.isEnabled) ||
      !(await argon2.verify(user.passwordHash, password))
    ) {
      throw new BusinessException({
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
        message: '用户名或密码错误',
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    const tokens = await this.issueTokens(user, identity);
    await this.loginRecords.save(
      this.loginRecords.create({
        userId: user.id,
        ip: client.ip.slice(0, 64),
        userAgent: client.userAgent.slice(0, 512),
      }),
    );
    return tokens;
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('REFRESH_TOKEN_SECRET'),
      });
    } catch {
      throw this.invalidRefreshToken();
    }

    if (payload.type !== 'refresh' || !payload.identityId || !payload.scope) {
      throw this.invalidRefreshToken();
    }

    const identity = await this.users.manager.findOne(UserIdentityEntity, {
      where: {
        id: payload.identityId,
        userId: payload.sub,
        scope: payload.scope,
      },
      relations: { user: true, roles: true },
    });
    if (
      !identity?.user ||
      identity.user.deletedAt ||
      identity.user.status !== UserStatus.Enabled ||
      !identity.roles.some((r) => r.isEnabled) ||
      !identity.refreshTokenHash ||
      !(await argon2.verify(identity.refreshTokenHash, refreshToken))
    )
      throw this.invalidRefreshToken();
    return this.issueTokens(identity.user, identity);
  }

  async logout(identityId: string): Promise<void> {
    await this.users.manager.update(UserIdentityEntity, identityId, {
      refreshTokenHash: null,
    });
  }

  async getCurrentUser(
    userId: string,
    identityId: string,
    scope: LoginScope,
  ): Promise<AuthenticatedUser> {
    if (!identityId || !scope) throw this.invalidRefreshToken();
    const identity = await this.users.manager.findOne(UserIdentityEntity, {
      where: { id: identityId, userId, scope },
      relations: { user: true, roles: true },
    });
    const user = identity?.user;
    if (
      !user ||
      user.deletedAt ||
      user.status !== UserStatus.Enabled ||
      !identity.roles.some((r) => r.isEnabled)
    ) {
      throw new BusinessException({
        code: ErrorCode.AUTH_TOKEN_INVALID,
        message: '访问令牌无效',
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    const roles = identity.roles.filter((r) => r.isEnabled).map((r) => r.code);
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      identityId: identity.id,
      scope,
      scopeName: SCOPE_NAMES[scope],
      deptId: identity.deptId,
      deptName:
        DEPARTMENT_OPTIONS.find((d) => d.value === identity.deptId)?.label ??
        '',
      roles,
      permissions: effectivePermissions(scope, roles),
      resourceLibrary: scope === 'headquarters' ? null : libraryFor(scope),
    };
  }

  async updateProfile(
    actor: AuthenticatedUser,
    input: UpdateProfileDto,
  ): Promise<void> {
    if (!actor.permissions.includes('sys:user:update'))
      throw new BusinessException({
        code: ErrorCode.AUTH_FORBIDDEN,
        message: '无权修改账号资料',
        status: HttpStatus.FORBIDDEN,
      });
    await this.users.update(
      { id: actor.id, status: UserStatus.Enabled },
      { ...input, updatedBy: actor.id },
    );
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.users.findOne({
      where: { id: userId, status: UserStatus.Enabled },
    });
    if (!user) {
      throw new BusinessException({
        code: ErrorCode.AUTH_TOKEN_INVALID,
        message: '访问令牌无效',
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    const incorrectPassword = () =>
      new BusinessException({
        code: ErrorCode.AUTH_PASSWORD_INCORRECT,
        message: '原密码不正确，请重新输入',
        status: HttpStatus.BAD_REQUEST,
      });
    if (!(await argon2.verify(user.passwordHash, oldPassword)))
      throw incorrectPassword();
    const result = await this.users.update(
      {
        id: userId,
        status: UserStatus.Enabled,
        passwordHash: user.passwordHash,
      },
      {
        passwordHash: await argon2.hash(newPassword),
        updatedBy: userId,
      },
    );
    if (!result.affected) throw incorrectPassword();
    await this.users.manager.update(
      UserIdentityEntity,
      { userId },
      { refreshTokenHash: null },
    );
  }

  async getProfile(actor: AuthenticatedUser): Promise<UserProfileResponse> {
    const user = await this.users.findOne({
      where: { id: actor.id, status: UserStatus.Enabled },
    });
    if (!user) {
      throw new BusinessException({
        code: ErrorCode.AUTH_TOKEN_INVALID,
        message: '访问令牌无效',
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      gender: user.gender,
      mobile: user.mobile,
      email: user.email,
      deptName: actor.deptName,
      createTime: user.createdAt.toISOString(),
    };
  }

  async getProfileSecurity(
    actor: AuthenticatedUser,
  ): Promise<ProfileSecurityResponse> {
    const user = await this.users.findOne({
      where: { id: actor.id, status: UserStatus.Enabled },
    });
    if (!user) {
      throw new BusinessException({
        code: ErrorCode.AUTH_TOKEN_INVALID,
        message: '访问令牌无效',
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    const identity = await this.users.manager.findOneOrFail(
      UserIdentityEntity,
      { where: { id: actor.identityId }, relations: { roles: true } },
    );
    const roles = identity.roles
      .filter((role) => role.isEnabled && actor.roles.includes(role.code))
      .sort((left, right) => left.code.localeCompare(right.code));
    const permissions = await this.users.manager.find(PermissionEntity, {
      where: { code: In([...new Set(actor.permissions)]) },
      order: { code: 'ASC' },
    });
    const records = await this.loginRecords.find({
      where: { userId: actor.id },
      order: { time: 'DESC', id: 'DESC' },
      take: 3,
    });
    return {
      roles: roles.map(({ code, name }) => ({ code, name })),
      permissions: permissions.map(({ code, name }) => ({ code, name })),
      recentLogins: records.map(({ id, time, ip, userAgent }) => ({
        id,
        time: time.toISOString(),
        ip,
        userAgent,
      })),
    };
  }

  private async issueTokens(
    user: UserEntity,
    identity: UserIdentityEntity,
  ): Promise<AuthTokens> {
    const accessPayload: JwtPayload = {
      sub: user.id,
      identityId: identity.id,
      scope: identity.scope,
      type: 'access',
    };
    const refreshPayload: JwtPayload = {
      sub: user.id,
      identityId: identity.id,
      scope: identity.scope,
      type: 'refresh',
    };
    const accessExpiresIn = this.config.getOrThrow<string>('JWT_EXPIRES_IN');

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: accessExpiresIn as JwtSignOptions['expiresIn'],
        jwtid: randomUUID(),
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: this.config.getOrThrow<string>('REFRESH_TOKEN_SECRET'),
        expiresIn: this.config.getOrThrow<string>(
          'REFRESH_TOKEN_EXPIRES_IN',
        ) as JwtSignOptions['expiresIn'],
        jwtid: randomUUID(),
      }),
    ]);

    identity.refreshTokenHash = await argon2.hash(refreshToken);
    await this.users.manager.save(identity);

    const decoded = this.jwt.decode<{
      exp: number;
      iat: number;
    }>(accessToken);
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: decoded.exp - decoded.iat,
    };
  }

  private invalidRefreshToken(): BusinessException {
    return new BusinessException({
      code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
      message: '刷新令牌无效',
      status: HttpStatus.UNAUTHORIZED,
    });
  }
}
