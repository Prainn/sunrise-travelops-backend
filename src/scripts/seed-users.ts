import { NestFactory } from '@nestjs/core';
import { DataSource, In } from 'typeorm';
import * as argon2 from 'argon2';
import { AppModule } from '../app.module';
import {
  ADMIN_PERMISSIONS,
  INQUIRY_PERMISSIONS,
  OPERATIONS_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  RESOURCE_PERMISSIONS,
} from '../auth/permissions';
import { PermissionEntity } from '../roles/permission.entity';
import { RoleEntity } from '../roles/role.entity';
import { UserEntity, UserStatus } from '../users/user.entity';

interface SeedUser {
  username: string;
  nickname: string;
  avatar: string;
  gender: number;
  mobile: string;
  email: string;
  deptId: number;
  createdAt: string;
  roleCodes: string[];
}

const roleDefinitions = [
  { code: 'ROOT', name: 'Root', permissionCodes: ADMIN_PERMISSIONS },
  {
    code: 'ADMIN',
    name: 'System Administrator',
    permissionCodes: ADMIN_PERMISSIONS,
  },
  {
    code: 'RESOURCE_MANAGER',
    name: 'Resource Manager',
    permissionCodes: RESOURCE_PERMISSIONS,
  },
  {
    code: 'INQUIRY_COORDINATOR',
    name: 'Inquiry Coordinator',
    permissionCodes: INQUIRY_PERMISSIONS,
  },
  {
    code: 'OPERATIONS_COORDINATOR',
    name: 'Operations Coordinator',
    permissionCodes: OPERATIONS_PERMISSIONS,
  },
] as const;

const seedUsers: SeedUser[] = [
  {
    username: 'admin',
    nickname: 'admin',
    avatar: '/favicon.ico',
    gender: 1,
    mobile: '17621210366',
    email: '',
    deptId: 1,
    createdAt: '2026-08-19T09:00:00+08:00',
    roleCodes: ['ROOT', 'ADMIN'],
  },
  {
    username: 'inquiry',
    nickname: '王敏',
    avatar: '/favicon.ico',
    gender: 0,
    mobile: '',
    email: 'inquiry@sunrise.local',
    deptId: 3,
    createdAt: '2026-08-19T09:10:00+08:00',
    roleCodes: ['INQUIRY_COORDINATOR'],
  },
  {
    username: 'resource',
    nickname: 'resource',
    avatar: '/favicon.ico',
    gender: 0,
    mobile: '',
    email: 'resource@sunrise.local',
    deptId: 2,
    createdAt: '2026-08-19T09:20:00+08:00',
    roleCodes: ['RESOURCE_MANAGER'],
  },
  {
    username: 'operations',
    nickname: '张伟',
    avatar: '/favicon.ico',
    gender: 0,
    mobile: '',
    email: 'operations@sunrise.local',
    deptId: 3,
    createdAt: '2026-08-19T09:30:00+08:00',
    roleCodes: ['OPERATIONS_COORDINATOR'],
  },
  {
    username: 'inquiry_lina',
    nickname: '李娜',
    avatar: '/favicon.ico',
    gender: 0,
    mobile: '',
    email: 'inquiry.lina@sunrise.local',
    deptId: 3,
    createdAt: '2026-08-19T09:40:00+08:00',
    roleCodes: ['INQUIRY_COORDINATOR'],
  },
  {
    username: 'inquiry_zhouyue',
    nickname: '周悦',
    avatar: '/favicon.ico',
    gender: 0,
    mobile: '',
    email: 'inquiry.zhouyue@sunrise.local',
    deptId: 3,
    createdAt: '2026-08-19T09:50:00+08:00',
    roleCodes: ['INQUIRY_COORDINATOR'],
  },
  {
    username: 'operations_chenchen',
    nickname: '陈晨',
    avatar: '/favicon.ico',
    gender: 0,
    mobile: '',
    email: 'operations.chenchen@sunrise.local',
    deptId: 3,
    createdAt: '2026-08-19T10:00:00+08:00',
    roleCodes: ['OPERATIONS_COORDINATOR'],
  },
  {
    username: 'operations_zhaolei',
    nickname: '赵磊',
    avatar: '/favicon.ico',
    gender: 0,
    mobile: '',
    email: 'operations.zhaolei@sunrise.local',
    deptId: 3,
    createdAt: '2026-08-19T10:10:00+08:00',
    roleCodes: ['OPERATIONS_COORDINATOR'],
  },
];

async function seed(): Promise<void> {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password || password.length < 6) {
    throw new Error(
      'SEED_USER_PASSWORD with at least 6 characters is required',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const dataSource = app.get(DataSource);

    await dataSource.transaction(async (manager) => {
      const permissions = manager.getRepository(PermissionEntity);
      const roles = manager.getRepository(RoleEntity);
      const users = manager.getRepository(UserEntity);

      await permissions.upsert(
        Object.entries(PERMISSION_DEFINITIONS).map(([code, name]) => ({
          code,
          name,
        })),
        ['code'],
      );
      const permissionRecords = await permissions.findBy({
        code: In(Object.keys(PERMISSION_DEFINITIONS)),
      });
      const permissionsByCode = new Map(
        permissionRecords.map((permission) => [permission.code, permission]),
      );

      const rolesByCode = new Map<string, RoleEntity>();
      for (const definition of roleDefinitions) {
        let role = await roles.findOneBy({ code: definition.code });
        role ??= roles.create({
          code: definition.code,
          createdBy: null,
          updatedBy: null,
        });
        role.name = definition.name;
        role.isEnabled = true;
        role.permissions = definition.permissionCodes.map((code) => {
          const permission = permissionsByCode.get(code);
          if (!permission) throw new Error(`Permission "${code}" is missing`);
          return permission;
        });
        rolesByCode.set(definition.code, await roles.save(role));
      }

      for (const input of seedUsers) {
        let user = await users.findOne({
          where: { username: input.username },
          withDeleted: true,
        });
        user ??= users.create({
          username: input.username,
          createdBy: null,
          updatedBy: null,
        });
        user.deletedAt = null;
        user.passwordHash = await argon2.hash(password);
        user.refreshTokenHash = null;
        user.status = UserStatus.Enabled;
        user.nickname = input.nickname;
        user.avatar = input.avatar;
        user.gender = input.gender;
        user.mobile = input.mobile;
        user.email = input.email;
        user.deptId = input.deptId;
        user.createdAt = new Date(input.createdAt);
        user.roles = input.roleCodes.map((code) => {
          const role = rolesByCode.get(code);
          if (!role) throw new Error(`Role "${code}" is missing`);
          return role;
        });
        await users.save(user);
      }

      const legacyAdminRole = await roles.findOne({
        where: { code: 'system_admin' },
        relations: { users: true },
      });
      if (legacyAdminRole && legacyAdminRole.users.length === 0) {
        await roles.remove(legacyAdminRole);
      }
      await permissions.delete({ code: In(['user:manage', 'role:manage']) });
    });

    process.stdout.write(`Seeded ${seedUsers.length} users.\n`);
  } finally {
    await app.close();
  }
}

void seed().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  process.stderr.write(`User seed failed: ${message}\n`);
  process.exitCode = 1;
});
