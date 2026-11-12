/** Account assignment and role retirement against disposable local PostgreSQL. */
import assert from 'node:assert/strict';
import { IsolationHarness } from './business-isolation.harness';
import type { UserItemResponse } from '../src/users/dto/user-management.dto';

const h = new IsolationHarness();

async function main() {
  await h.start();
  const root = await h.actor('headquarters', 'ROOT');
  const legacy = await h.actor('headquarters', 'EXECUTIVE');
  const assignments = await h.db.query<{ code: string; id: string }[]>(
    "SELECT code,id FROM roles WHERE code IN ('ADMIN','BOSS','EXECUTIVE','ROOT')",
  );
  const role = (code: string) => assignments.find((r) => r.code === code)!.id;

  const options = await h.call<{ code: string; scopes: string[] }[]>(
    root,
    'GET',
    '/users/options/roles',
  );
  assert.deepEqual(
    options.filter((r) => r.scopes.includes('headquarters')).map((r) => r.code),
    ['ADMIN'],
  );
  const menu = '/system/menu-permissions';
  const { roles } = await h.call<{ roles: { code: string }[] }>(
    root,
    'GET',
    menu,
  );
  assert(!roles.some((r) => r.code === 'EXECUTIVE'));

  const user = {
    nickname: 'HQ staff',
    englishName: 'HQ staff',
    status: 1,
  };
  const identity = (deptId: number, code: string) => ({
    scope: 'headquarters',
    deptId,
    roleIds: [role(code)],
  });
  const create = (deptId: number, code: string) => ({
    ...user,
    username: `hq_test_${deptId}`,
    password: 'test-only-password',
    identities: [identity(deptId, code)],
  });
  for (const code of ['EXECUTIVE', 'ROOT', 'BOSS'])
    await h.call(
      root,
      'POST',
      '/users',
      create(4, code),
      403,
      'AUTH_FORBIDDEN',
    );
  const admin = await h.call<UserItemResponse>(
    root,
    'POST',
    '/users',
    create(4, 'ADMIN'),
    201,
  );
  await h.call(root, 'PUT', `/users/${admin.id}`, {
    ...user,
    identities: [identity(1, 'ADMIN')],
  });
  for (const code of ['EXECUTIVE', 'ROOT', 'BOSS'])
    await h.call(
      root,
      'PUT',
      `/users/${admin.id}`,
      {
        ...user,
        identities: [identity(1, code)],
      },
      403,
      'AUTH_FORBIDDEN',
    );
  const login = await h.call<{ accessToken: string }>(
    undefined,
    'POST',
    '/auth/login',
    {
      scope: 'headquarters',
      username: 'hq_test_4',
      password: 'test-only-password',
    },
  );
  const adminActor = {
    id: admin.id,
    identityId: admin.identities[0].id,
    scope: 'headquarters' as const,
    token: login.accessToken,
  };

  // Recreate the prior EXECUTIVE catalog rows and verify the destructive upgrade.
  const executiveId = role('EXECUTIVE');
  await h.db.query(
    "INSERT INTO role_menu_configs(role_id,menu_keys) VALUES ($1,ARRAY['users'])",
    [executiveId],
  );
  await h.db.query(
    "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code='sys:user:list'",
    [executiveId],
  );
  await h.db.query(
    "DELETE FROM migrations WHERE name='RemoveExecutiveRole1796256003000'",
  );
  await h.db.query(
    'INSERT INTO identity_roles(identity_id,role_id) VALUES ($1,$2)',
    [legacy.identityId, role('ADMIN')],
  );
  await assert.rejects(
    h.db.runMigrations(),
    /Resolve mixed headquarters EXECUTIVE and ADMIN/,
  );
  assert.equal(
    (
      await h.db.query<unknown[]>('SELECT id FROM roles WHERE id=$1', [
        executiveId,
      ])
    ).length,
    1,
  );
  await h.db.query(
    'DELETE FROM identity_roles WHERE identity_id=$1 AND role_id=$2',
    [legacy.identityId, role('ADMIN')],
  );
  assert.equal((await h.db.runMigrations()).length, 1);
  assert.equal((await h.db.runMigrations()).length, 0);
  for (const table of [
    'role_menu_configs',
    'identity_roles',
    'role_permissions',
  ])
    assert.equal(
      (
        await h.db.query<unknown[]>(
          `SELECT role_id FROM ${table} WHERE role_id=$1`,
          [executiveId],
        )
      ).length,
      0,
    );
  assert.equal(
    (
      await h.db.query<unknown[]>('SELECT id FROM roles WHERE id=$1', [
        executiveId,
      ])
    ).length,
    0,
  );
  assert.equal(
    (
      await h.db.query<unknown[]>('SELECT id FROM users WHERE id=$1', [
        legacy.id,
      ])
    ).length,
    1,
  );

  await h.call(legacy, 'GET', '/auth/me', undefined, 401, 'AUTH_TOKEN_INVALID');
  assert.deepEqual(
    (await h.call<{ roles: string[] }>(adminActor, 'GET', '/auth/me')).roles,
    ['ADMIN'],
  );
  assert.deepEqual(
    (await h.call<{ roles: string[] }>(root, 'GET', '/auth/me')).roles,
    ['ROOT'],
  );
  console.log(
    `PASS Headquarters role assignment and retirement: ${h.requests} HTTP checks`,
  );
}
main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => h.close());
