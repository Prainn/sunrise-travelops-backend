import { AccountLinksService } from '../users/account-links.service';
import { lockAccountLinks } from '../users/account-links.rules';
import { OperationLogEntity } from '../operation-logs/operation-log.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  UserIdentityEntity,
  LoginScope,
  SCOPE_NAMES,
} from '../users/user-identity.entity';
import { effectiveAccountPermissions } from './identity-permissions';
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
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { PermissionEntity } from '../roles/permission.entity';
import { ErrorCode } from '../common/constants/error-code';
import { BusinessException } from '../common/exceptions/business.exception';
import { UserEntity, UserStatus } from '../users/user.entity';
import { AuthenticatedUser, AuthTokens, JwtPayload } from './auth.types';
import { MenuPermissionsService } from '../roles/menu-permissions.service';
import { validMenuSnapshot } from '../roles/menu-definitions';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(UserLoginRecordEntity)
    private readonly loginRecords: Repository<UserLoginRecordEntity>,
    private readonly menus: MenuPermissionsService,
    private readonly links: AccountLinksService,
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
    const tokens = await this.users.manager.transaction(async (manager) => {
      await lockAccountLinks(manager);
      const current = await manager.findOne(UserIdentityEntity, {
        where: { id: identity.id },
        relations: { user: true, roles: true },
      });
      if (
        !current?.user ||
        current.user.deletedAt ||
        current.user.status !== UserStatus.Enabled ||
        current.user.passwordHash !== user.passwordHash ||
        !current.roles.some((r) => r.isEnabled)
      )
        throw new BusinessException({
          code: 'AUTH_INVALID_CREDENTIALS',
          message: '用户名或密码错误',
          status: HttpStatus.UNAUTHORIZED,
        });
      return this.issueTokens(current.user, current, undefined, manager);
    });
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

    if (
      payload.type !== 'refresh' ||
      !payload.identityId ||
      !payload.scope ||
      !validMenuSnapshot(payload.menuKeys)
    ) {
      throw this.invalidRefreshToken();
    }

    return this.users.manager.transaction(async (manager) => {
      await lockAccountLinks(manager);
      const session = await this.requireSession(manager, payload);
      const identity = await manager.findOne(UserIdentityEntity, {
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
        !(await argon2.verify(session.refreshTokenHash, refreshToken))
      )
        throw this.invalidRefreshToken();
      return this.issueTokens(
        identity.user,
        identity,
        payload.menuKeys,
        manager,
        { id: payload.sid!, version: payload.sv! },
      );
    });
  }

  private async requireSession(
    manager: EntityManager,
    payload: Pick<JwtPayload, 'sid' | 'sv' | 'sub' | 'identityId'>,
  ) {
    if (!payload.sid || !Number.isInteger(payload.sv))
      throw this.invalidRefreshToken();
    const [session] = await manager.query<{ refreshTokenHash: string }[]>(
      `SELECT refresh_token_hash AS "refreshTokenHash" FROM auth_account_sessions WHERE id=$1 AND version=$2 AND user_id=$3 AND identity_id=$4 AND expires_at>now()`,
      [payload.sid, payload.sv, payload.sub, payload.identityId],
    );
    if (!session) throw this.invalidRefreshToken();
    return session;
  }

  async logout(actor: AuthenticatedUser): Promise<void> {
    await this.users.manager.transaction(async (manager) => {
      await lockAccountLinks(manager);
      await manager.query(
        'DELETE FROM auth_account_sessions WHERE id=$1 AND user_id=$2 AND version=$3',
        [actor.sessionId, actor.id, actor.sessionVersion],
      );
    });
  }

  linkedAccounts(actor: AuthenticatedUser) {
    return this.links.switchTargets(actor);
  }

  async switchAccount(
    actor: AuthenticatedUser,
    targetUserId: string,
    ip: string,
  ): Promise<AuthTokens> {
    return this.users.manager.transaction(async (manager) => {
      await lockAccountLinks(manager);
      await this.requireSession(manager, {
        sid: actor.sessionId,
        sv: actor.sessionVersion,
        sub: actor.id,
        identityId: actor.identityId,
      });
      const target = await this.links.requireTarget(
        manager,
        actor,
        targetUserId,
      );
      const tokens = await this.issueTokens(
        target.user,
        target,
        undefined,
        manager,
        { id: actor.sessionId!, version: actor.sessionVersion! + 1 },
      );
      await manager.insert(OperationLogEntity, {
        category: 'login',
        action: '切换账号',
        success: true,
        actorId: actor.id,
        actorName: actor.username,
        scope: actor.scope,
        ip: ip.slice(0, 64),
        detail: JSON.stringify({
          sessionId: actor.sessionId,
          fromUserId: actor.id,
          fromIdentityId: actor.identityId,
          toUserId: target.userId,
          toIdentityId: target.id,
          toScope: target.scope,
        }),
      });
      return tokens;
    });
  }

  async getCurrentUser(
    userId: string,
    identityId: string,
    scope: LoginScope,
    menuKeys: string[],
    sessionId?: string,
    sessionVersion?: number,
  ): Promise<AuthenticatedUser> {
    if (!identityId || !scope) throw this.invalidRefreshToken();
    try {
      await this.requireSession(this.users.manager, {
        sid: sessionId,
        sv: sessionVersion,
        sub: userId,
        identityId,
      });
    } catch (error) {
      if (!(error instanceof BusinessException)) throw error;
      throw new BusinessException({
        code: 'AUTH_TOKEN_INVALID',
        message: '访问令牌无效，请重新登录',
        status: HttpStatus.UNAUTHORIZED,
      });
    }
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
      sessionId,
      sessionVersion,
      identityId: identity.id,
      scope,
      scopeName: SCOPE_NAMES[scope],
      deptId: identity.deptId,
      deptName:
        DEPARTMENT_OPTIONS.find((d) => d.value === identity.deptId)?.label ??
        '',
      roles,
      permissions: effectiveAccountPermissions(
        scope,
        roles,
        identity.coordinatorDuty,
        user.username,
      ),
      menuKeys,
    };
  }

  async updateProfile(
    actor: AuthenticatedUser,
    input: UpdateProfileDto,
  ): Promise<void> {
    // Reject identifiers (and all other non-profile fields), even for direct callers.
    // Never spread request data into the persistence update or its target criteria.
    const unexpected = Object.keys(input).filter(
      (key) => !['nickname', 'avatar', 'gender'].includes(key),
    );
    if (unexpected.length)
      throw new BusinessException({
        code: ErrorCode.VALIDATION_ERROR,
        message: '个人资料只允许修改昵称、头像和性别',
        status: HttpStatus.BAD_REQUEST,
      });
    const { nickname, avatar, gender } = input;
    const result = await this.users.update(
      { id: actor.id, status: UserStatus.Enabled, deletedAt: IsNull() },
      { nickname, avatar, gender, updatedBy: actor.id },
    );
    if (!result.affected)
      throw new BusinessException({
        code: ErrorCode.AUTH_TOKEN_INVALID,
        message: '账号不可用',
        status: HttpStatus.UNAUTHORIZED,
      });
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.users.manager.transaction(async (manager) => {
      await lockAccountLinks(manager);
      const user = await manager.findOne(UserEntity, {
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
      const result = await manager.update(
        UserEntity,
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
      await manager.query(
        'DELETE FROM auth_account_sessions WHERE user_id=$1',
        [userId],
      );
    });
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
    snapshot?: string[],
    manager = this.users.manager,
    session: { id: string; version: number } = { id: randomUUID(), version: 1 },
  ): Promise<AuthTokens> {
    const menuKeys =
      snapshot ??
      (await this.menus.snapshot(
        identity.scope,
        identity.roles
          .filter((role) => role.isEnabled)
          .map((role) => role.code),
      ));
    const accessPayload: JwtPayload = {
      sub: user.id,
      identityId: identity.id,
      scope: identity.scope,
      type: 'access',
      sid: session.id,
      sv: session.version,
      menuKeys,
    };
    const refreshPayload: JwtPayload = {
      sub: user.id,
      identityId: identity.id,
      scope: identity.scope,
      type: 'refresh',
      sid: session.id,
      sv: session.version,
      menuKeys,
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

    const refreshHash = await argon2.hash(refreshToken);
    const refreshExpiry = this.jwt.decode<{ exp: number }>(refreshToken).exp;
    await manager.query(
      `INSERT INTO auth_account_sessions(id,user_id,identity_id,version,refresh_token_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,to_timestamp($6)) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,identity_id=excluded.identity_id,
      version=excluded.version,refresh_token_hash=excluded.refresh_token_hash,expires_at=excluded.expires_at`,
      [
        session.id,
        user.id,
        identity.id,
        session.version,
        refreshHash,
        refreshExpiry,
      ],
    );

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
