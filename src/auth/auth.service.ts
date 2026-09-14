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
import { Repository } from 'typeorm';
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
  ): Promise<AuthTokens> {
    const user = await this.findUser(username);
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new BusinessException({
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
        message: '用户名或密码错误',
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    const tokens = await this.issueTokens(user);
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

    if (payload.type !== 'refresh') {
      throw this.invalidRefreshToken();
    }

    const user = await this.users.findOne({
      where: { id: payload.sub, status: UserStatus.Enabled },
    });
    if (
      !user?.refreshTokenHash ||
      !(await argon2.verify(user.refreshTokenHash, refreshToken))
    ) {
      throw this.invalidRefreshToken();
    }
    return this.issueTokens(user);
  }

  async logout(userId: string): Promise<void> {
    await this.users.update(userId, { refreshTokenHash: null });
  }

  async getCurrentUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.users.findOne({
      where: { id: userId, status: UserStatus.Enabled },
      relations: { roles: { permissions: true } },
    });
    if (!user) {
      throw new BusinessException({
        code: ErrorCode.AUTH_TOKEN_INVALID,
        message: '访问令牌无效',
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    return this.toAuthenticatedUser(user);
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
        refreshTokenHash: null,
        updatedBy: userId,
      },
    );
    if (!result.affected) throw incorrectPassword();
  }

  async getProfile(userId: string): Promise<UserProfileResponse> {
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
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      gender: user.gender,
      mobile: user.mobile,
      email: user.email,
      deptName:
        DEPARTMENT_OPTIONS.find((option) => option.value === user.deptId)
          ?.label ?? '',
      createTime: user.createdAt.toISOString(),
    };
  }

  async getProfileSecurity(userId: string): Promise<ProfileSecurityResponse> {
    const user = await this.users.findOne({
      where: { id: userId, status: UserStatus.Enabled },
      relations: { roles: { permissions: true } },
    });
    if (!user) {
      throw new BusinessException({
        code: ErrorCode.AUTH_TOKEN_INVALID,
        message: '访问令牌无效',
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    const roles = user.roles
      .filter((role) => role.isEnabled)
      .sort((a, b) => a.code.localeCompare(b.code));
    const permissions = new Map(
      roles.flatMap((role) =>
        role.permissions.map(
          (permission) =>
            [
              permission.code,
              { code: permission.code, name: permission.name },
            ] as const,
        ),
      ),
    );
    const records = await this.loginRecords.find({
      where: { userId },
      order: { time: 'DESC', id: 'DESC' },
      take: 3,
    });
    return {
      roles: roles.map(({ code, name }) => ({ code, name })),
      permissions: [...permissions.values()].sort((a, b) =>
        a.code.localeCompare(b.code),
      ),
      recentLogins: records.map(({ id, time, ip, userAgent }) => ({
        id,
        time: time.toISOString(),
        ip,
        userAgent,
      })),
    };
  }

  private async findUser(username: string): Promise<UserEntity | null> {
    return this.users.findOne({
      where: { username, status: UserStatus.Enabled },
    });
  }

  private async issueTokens(user: UserEntity): Promise<AuthTokens> {
    const accessPayload: JwtPayload = {
      sub: user.id,
      type: 'access',
    };
    const refreshPayload: JwtPayload = {
      sub: user.id,
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

    user.refreshTokenHash = await argon2.hash(refreshToken);
    await this.users.save(user);

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

  private toAuthenticatedUser(user: UserEntity): AuthenticatedUser {
    const permissions = new Set(
      user.roles
        .filter((role) => role.isEnabled)
        .flatMap((role) =>
          role.permissions.map((permission) => permission.code),
        ),
    );
    return {
      id: user.id,
      username: user.username,
      permissions: [...permissions].sort(),
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
