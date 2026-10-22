/** Disposable PostgreSQL only; never reads business environment files. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccountLinksService } from '../src/users/account-links.service';
import {
  availableTourCode,
  lockAccountLinks,
} from '../src/users/account-links.rules';
import { UserEntity, UserStatus } from '../src/users/user.entity';
import {
  UserIdentityEntity,
  LoginScope,
} from '../src/users/user-identity.entity';
import { RoleEntity } from '../src/roles/role.entity';
import { MenuPermissionsService } from '../src/roles/menu-permissions.service';
import { AuthService } from '../src/auth/auth.service';
import {
  AuthenticatedUser,
  AuthTokens,
  JwtPayload,
} from '../src/auth/auth.types';
import { UserLoginRecordEntity } from '../src/auth/user-login-record.entity';
import {
  CreateAccountLinkDto,
  UpdateAccountLinkDto,
} from '../src/users/dto/account-link.dto';
import { AddAccountLinksAndSessions1793404800000 } from '../src/migrations/1793404800000-AddAccountLinksAndSessions';

async function main() {
  const folder = resolve(__dirname, '../src/migrations');
  const oldMigrations = readdirSync(folder)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('1793404800000'))
    .map((f) => resolve(folder, f));
  const options = {
    type: 'postgres' as const,
    host: '127.0.0.1',
    port: 55439,
    username: 'account_test',
    password: 'isolated-only',
    database: 'account_links_test',
    entities: [resolve(__dirname, '../src/**/*.entity.ts')],
    synchronize: false,
  };
  let db = await new DataSource({
    ...options,
    migrations: oldMigrations,
  }).initialize();
  const baseline = await db.runMigrations({ transaction: 'all' });
  assert(baseline.length > 50);
  const hash = await argon2.hash('Isolated-Test-Password-1');
  async function account(
    scope: LoginScope,
    tourCode: string,
    superuser = false,
  ) {
    const id = randomUUID();
    const user = db.manager.create(UserEntity, {
      id,
      username: `test-${id}`,
      nickname: `name-${scope}`,
      englishName: 'Test',
      tourCode,
      passwordHash: hash,
      status: UserStatus.Enabled,
      isSuperuser: superuser,
    });
    await db.query(
      `INSERT INTO users(id,username,nickname,english_name,tour_code,password_hash,status,is_superuser)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        user.username,
        user.nickname,
        user.englishName,
        tourCode,
        hash,
        user.status,
        superuser,
      ],
    );
    const role = await db.manager.findOneByOrFail(RoleEntity, {
      code: scope === 'headquarters' ? 'ROOT' : 'COORDINATOR',
    });
    const identity = await db.manager.save(
      UserIdentityEntity,
      db.manager.create(UserIdentityEntity, {
        userId: id,
        username: user.username,
        scope,
        roles: [role],
        coordinatorDuty: scope === 'headquarters' ? null : 'both',
      }),
    );
    return { user, identity };
  }
  // A representative pre-upgrade account and historical reservation must survive unchanged.
  const a = await account('shengxu', 'AS');
  const b = await account('website', 'AIS');
  const c = await account('linxi', 'CS');
  const h = await account('headquarters', 'HQ');
  await db.query(
    "INSERT INTO website_inquiry_numbers(code,creator_code,creation_date,sequence) VALUES('KMLX-WIQ-261021AS1-MYS','AS','2026-10-21',1)",
  );
  await db.destroy();
  db = await new DataSource({
    ...options,
    migrations: [...oldMigrations, AddAccountLinksAndSessions1793404800000],
  }).initialize();
  assert.equal((await db.runMigrations({ transaction: 'all' })).length, 1);
  assert.equal((await db.runMigrations({ transaction: 'all' })).length, 0);
  assert.equal(
    (await db.manager.findOneByOrFail(UserEntity, { id: a.user.id })).tourCode,
    'AS',
  );
  assert.equal(
    (
      await db.query<{ code: string }[]>(
        'SELECT code FROM website_inquiry_numbers',
      )
    )[0].code,
    'KMLX-WIQ-261021AS1-MYS',
  );
  const links = new AccountLinksService(db),
    jwt = new JwtService();
  const auth = new AuthService(
    db.getRepository(UserEntity),
    jwt,
    new ConfigService({
      JWT_SECRET: 'isolated-access-key',
      REFRESH_TOKEN_SECRET: 'isolated-refresh-key',
      JWT_EXPIRES_IN: '15m',
      REFRESH_TOKEN_EXPIRES_IN: '7d',
    }),
    db.getRepository(UserLoginRecordEntity),
    new MenuPermissionsService(db),
    links,
  );
  const root: AuthenticatedUser = {
    id: h.user.id,
    identityId: h.identity.id,
    scope: 'headquarters',
    scopeName: '总部',
    roles: ['ROOT'],
    username: h.user.username,
    nickname: 'Root',
    permissions: ['sys:account-link:manage'],
    menuKeys: [],
    deptId: null,
    deptName: '',
  };
  const create = (
    ids: string[],
    mode: 'keep' | 'unify' = 'keep',
    tourCode?: string,
  ) =>
    plainToInstance(CreateAccountLinkDto, {
      userIds: ids,
      tourCodeMode: mode,
      ...(tourCode ? { tourCode } : {}),
    });
  const client = { ip: '127.0.0.1', userAgent: 'isolated-test' };
  const current = (tokens: AuthTokens) => {
    const p = jwt.decode<JwtPayload>(tokens.accessToken);
    return auth.getCurrentUser(
      p.sub,
      p.identityId,
      p.scope,
      p.menuKeys,
      p.sid,
      p.sv,
    );
  };
  await assert.rejects(
    links.save(create([a.user.id, h.user.id]), root, '127.0.0.1'),
  );
  await assert.rejects(
    links.save(
      create([a.user.id, b.user.id]),
      { ...root, roles: ['ADMIN', 'EXECUTIVE'] },
      '',
    ),
  );
  await assert.rejects(
    links.save(
      create([a.user.id, b.user.id]),
      { ...root, scope: 'website', roles: ['BUSINESS_MANAGER'] },
      '',
    ),
  );
  assert((await validate(create([a.user.id]))).length > 0);
  assert((await validate(create([a.user.id, b.user.id], 'unify'))).length > 0);
  let group = (await links.save(create([a.user.id, b.user.id]), root, ''))!;
  assert.deepEqual(group.members.map((u) => u.tourCode).sort(), ['AIS', 'AS']);
  assert.equal(
    (await links.candidates({ page: 1, pageSize: 20 }, root)).total,
    1,
  );
  assert.equal((await links.list({ page: 1, pageSize: 20 }, root)).total, 1);
  await assert.rejects(links.save(create([a.user.id, c.user.id]), root, ''));
  await assert.rejects(
    links.save(
      plainToInstance(UpdateAccountLinkDto, {
        userIds: [a.user.id, b.user.id],
        tourCodeMode: 'unify',
        tourCode: 'CS',
        version: group.version,
      }),
      root,
      '',
      group.id,
    ),
  );
  assert.equal((await links.get(group.id, root)).version, group.version);
  group = (await links.save(
    plainToInstance(UpdateAccountLinkDto, {
      userIds: [a.user.id, b.user.id],
      tourCodeMode: 'unify',
      tourCode: 'AS',
      version: group.version,
    }),
    root,
    '',
    group.id,
  ))!;
  await db.transaction(async (m) => {
    await lockAccountLinks(m);
    await availableTourCode(m, 'AS', b.user.id);
  });
  await assert.rejects(
    db.transaction(async (m) => {
      await lockAccountLinks(m);
      await availableTourCode(m, 'AS', c.user.id);
    }),
  );
  await assert.rejects(
    db.transaction(async (m) => {
      await lockAccountLinks(m);
      await availableTourCode(m, 'AS');
    }),
  );
  await assert.rejects(
    links.save({ version: group.version }, root, '', group.id, true),
  );
  assert.equal((await links.get(group.id, root)).members.length, 2);
  const tokens = await auth.login(
    a.user.username,
    'Isolated-Test-Password-1',
    client,
    'shengxu',
  );
  const independent = await auth.login(
    a.user.username,
    'Isolated-Test-Password-1',
    client,
    'shengxu',
  );
  const actor = await current(tokens);
  assert.equal((await auth.linkedAccounts(actor)).length, 2);
  await assert.rejects(auth.switchAccount(actor, c.user.id, ''));
  await db.manager.update(UserEntity, b.user.id, {
    status: UserStatus.Disabled,
  });
  await assert.rejects(auth.switchAccount(actor, b.user.id, ''));
  await db.manager.update(UserEntity, b.user.id, {
    status: UserStatus.Enabled,
  });
  const switched = await auth.switchAccount(actor, b.user.id, '');
  const target = await current(switched);
  assert.equal(target.id, b.user.id);
  assert.equal(target.scope, 'website');
  assert(!target.permissions.includes('sys:account-link:manage'));
  assert(
    !target.permissions.includes('inquiry:create') ||
      !target.permissions.includes('sys:menu-permission:update'),
  );
  await assert.rejects(current(tokens));
  await assert.rejects(auth.refresh(tokens.refreshToken));
  assert.equal((await current(independent)).id, a.user.id);
  const races = await Promise.allSettled([
    auth.switchAccount(target, a.user.id, ''),
    auth.switchAccount(target, a.user.id, ''),
  ]);
  assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
  group = (await links.save(
    plainToInstance(UpdateAccountLinkDto, {
      userIds: [a.user.id, b.user.id],
      tourCodeMode: 'keep',
      version: group.version,
    }),
    root,
    '',
    group.id,
  ))!;
  assert(group.members.every((u) => u.tourCode === 'AS'));
  await links.save(
    {
      version: group.version,
      tourCodes: [{ userId: b.user.id, tourCode: 'AIS' }],
    },
    root,
    '',
    group.id,
    true,
  );
  assert.equal(
    (await links.switchTargets(await current(independent))).length,
    0,
  );
  await assert.rejects(
    auth.switchAccount(await current(independent), b.user.id, ''),
  );
  const rotated = await auth.refresh(independent.refreshToken);
  await assert.rejects(auth.refresh(independent.refreshToken));
  await auth.logout(await current(rotated));
  await assert.rejects(current(rotated));
  const passwordSession = await auth.login(
    a.user.username,
    'Isolated-Test-Password-1',
    client,
    'shengxu',
  );
  await auth.changePassword(
    a.user.id,
    'Isolated-Test-Password-1',
    'Isolated-Changed-Password-2',
  );
  await assert.rejects(current(passwordSession));
  await assert.rejects(auth.refresh(passwordSession.refreshToken));
  await assert.rejects(
    auth.login(a.user.username, 'Isolated-Test-Password-1', client, 'shengxu'),
  );
  await current(
    await auth.login(
      a.user.username,
      'Isolated-Changed-Password-2',
      client,
      'shengxu',
    ),
  );
  const [logs] = await db.query<{ count: number }[]>(
    "SELECT count(*)::int AS count FROM operation_logs WHERE action IN ('建立账号关联','调整账号关联','解除账号关联','切换账号')",
  );
  assert(logs.count >= 6);
  console.log(
    'Account links: old-data upgrade, repeat migrations, authorization, group invariants, atomic code conflict/unlink, target status, token revocation, independent sessions, concurrent switch, refresh/logout and audit passed.',
  );
  await db.destroy();
}
main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
