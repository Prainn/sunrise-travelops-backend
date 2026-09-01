import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { UserEntity, UserStatus } from '../users/user.entity';
import { AuthenticatedUser, AuthTokens, JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(username: string, password: string): Promise<AuthTokens> {
    const user = await this.findUser(username);
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid username or password');
    }
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('REFRESH_TOKEN_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.users.findOne({
      where: { id: payload.sub, status: UserStatus.Enabled },
    });
    if (
      !user?.refreshTokenHash ||
      !(await argon2.verify(user.refreshTokenHash, refreshToken))
    ) {
      throw new UnauthorizedException('Invalid refresh token');
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
      throw new UnauthorizedException();
    }
    return this.toAuthenticatedUser(user);
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
}
