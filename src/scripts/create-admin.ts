import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { PERMISSION_DEFINITIONS } from '../auth/permissions';
import { PermissionEntity } from '../roles/permission.entity';
import { RoleEntity } from '../roles/role.entity';
import { UserEntity, UserStatus } from '../users/user.entity';

async function createAdmin(): Promise<void> {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password || password.length < 6) {
    throw new Error(
      'ADMIN_USERNAME and an ADMIN_PASSWORD of at least 6 characters are required',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const users = app.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
    const roles = app.get<Repository<RoleEntity>>(
      getRepositoryToken(RoleEntity),
    );
    const permissions = app.get<Repository<PermissionEntity>>(
      getRepositoryToken(PermissionEntity),
    );

    if (await users.existsBy({ username })) {
      throw new Error(`User "${username}" already exists`);
    }

    const permissionRecords: PermissionEntity[] = [];
    for (const [code, name] of Object.entries(PERMISSION_DEFINITIONS)) {
      let permission = await permissions.findOneBy({ code });
      permission ??= permissions.create({ code, name });
      permissionRecords.push(await permissions.save(permission));
    }

    let adminRole = await roles.findOne({
      where: { code: 'system_admin' },
      relations: { permissions: true },
    });
    if (!adminRole) {
      adminRole = roles.create({
        code: 'system_admin',
        name: 'System Administrator',
        isEnabled: true,
        permissions: permissionRecords,
        createdBy: null,
        updatedBy: null,
      });
    } else {
      adminRole.permissions = permissionRecords;
    }
    adminRole = await roles.save(adminRole);

    await users.save(
      users.create({
        username,
        nickname: username,
        avatar: '',
        gender: 0,
        mobile: '',
        email: '',
        deptId: null,
        passwordHash: await argon2.hash(password),
        refreshTokenHash: null,
        status: UserStatus.Enabled,
        roles: [adminRole],
        createdBy: null,
        updatedBy: null,
      }),
    );
    process.stdout.write(`Created administrator "${username}".\n`);
  } finally {
    await app.close();
  }
}

void createAdmin().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  process.stderr.write(`Administrator creation failed: ${message}\n`);
  process.exitCode = 1;
});
