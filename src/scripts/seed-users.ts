import { UserIdentityEntity } from '../users/user-identity.entity';
import { NestFactory } from '@nestjs/core';
import { DataSource, In } from 'typeorm';
import * as argon2 from 'argon2';
import { AppModule } from '../app.module';
import { PERMISSION_DEFINITIONS } from '../auth/permissions';
import { ROLE_PERMISSIONS } from '../auth/identity-permissions';
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

const roleDefinitions = Object.entries(ROLE_PERMISSIONS).map(
  ([code, permissionCodes]) => ({
    code,
    name: (
      {
        ROOT: '超级管理员',
        ADMIN: '系统管理部',
        EXECUTIVE: '总经办',
        BUSINESS_MANAGER: '业务部门负责人',
        COORDINATOR: '计调',
        RESOURCE_MANAGER: '资源管理员',
      } as Record<string, string>
    )[code],
    permissionCodes,
  }),
);
const permissionDefinitions = {
  ...PERMISSION_DEFINITIONS,
  'inquiry:transfer': '询盘转交',
  'itinerary:download': '下载已有冻结报价',
};

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
    roleCodes: ['ADMIN'],
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
    roleCodes: ['COORDINATOR'],
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
    roleCodes: ['COORDINATOR'],
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
    roleCodes: ['COORDINATOR'],
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
    roleCodes: ['COORDINATOR'],
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
    roleCodes: ['COORDINATOR'],
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
    roleCodes: ['COORDINATOR'],
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
        Object.entries(permissionDefinitions).map(([code, name]) => ({
          code,
          name,
        })),
        ['code'],
      );
      const permissionRecords = await permissions.findBy({
        code: In(Object.keys(permissionDefinitions)),
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
        const scope = input.deptId === 1 ? 'headquarters' : 'shengxu';
        const existing = await manager.findOne(UserIdentityEntity, {
          where: { username: input.username, scope },
          relations: { user: true },
          withDeleted: true,
        });
        let user = existing?.user;
        user ??= users.create({
          username: input.username,
          createdBy: null,
          updatedBy: null,
        });
        user.deletedAt = null;
        user.passwordHash = await argon2.hash(password);
        user.status = UserStatus.Enabled;
        user.nickname = input.nickname;
        user.avatar = input.avatar;
        user.gender = input.gender;
        user.mobile = input.mobile;
        user.email = input.email;
        user.createdAt = new Date(input.createdAt);
        const assignedRoles = input.roleCodes.map((code) => {
          const role = rolesByCode.get(code);
          if (!role) throw new Error(`Role "${code}" is missing`);
          return role;
        });
        await users.save(user);
        await manager.save(
          UserIdentityEntity,
          manager.create(UserIdentityEntity, {
            id: existing?.id,
            userId: user.id,
            username: user.username,
            scope,
            deptId: input.deptId,
            roles: assignedRoles,
            refreshTokenHash: null,
          }),
        );
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
