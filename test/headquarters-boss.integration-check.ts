/** Role upgrade and effective access against a disposable local PostgreSQL. */
import assert from 'node:assert/strict';
import { IsolationHarness, Page } from './business-isolation.harness';
import { RoleMenuConfig } from '../src/roles/menu-permissions.service';

const h = new IsolationHarness();
const path = '/system/menu-permissions';
const blockedMenus = [
  'whatsapp-inbox',
  'whatsapp-quick-replies',
  'whatsapp-integration',
  'operations',
  'website-visits',
  'account-links',
  'menu-permissions',
];

async function main() {
  await h.start();
  // Recreate the pre-upgrade state in this disposable database.
  await h.db.query(`
    DELETE FROM role_menu_configs WHERE role_id IN (SELECT id FROM roles WHERE code='BOSS');
    DELETE FROM roles WHERE code='BOSS';
    DELETE FROM migrations WHERE name='AddHeadquartersBossRole1796256002000';
  `);
  const mango = await h.actor('headquarters', 'ROOT', null, undefined, 'mango');
  const sunrise = await h.actor(
    'headquarters',
    'ROOT',
    null,
    undefined,
    'sunrise',
  );
  await h.db.query(
    `INSERT INTO account_menu_configs(username,menu_keys,version)
     VALUES ('sunrise',ARRAY['whatsapp-inbox','operations'],2)`,
  );
  const oldToken = await h.call<{ roles: string[] }>(
    sunrise,
    'GET',
    '/auth/me',
  );
  assert.deepEqual(oldToken.roles, ['ROOT']);
  await h.db.query(
    "UPDATE users SET status='disabled', is_superuser=true WHERE id=$1",
    [sunrise.id],
  );
  assert.equal((await h.db.runMigrations()).length, 1);
  assert.equal((await h.db.runMigrations()).length, 0);
  const [account] = await h.db.query<{ status: string }[]>(
    'SELECT status FROM users WHERE id=$1',
    [sunrise.id],
  );
  assert.equal(account?.status, 'disabled');
  const management = '/users?view=management';
  type ListedUser = {
    username: string;
    status: number;
    readOnly?: boolean;
    identities: { deptId: number; deptName: string; roleNames: string }[];
  };
  const bossPage = await h.call<Page<ListedUser>>(
    mango,
    'GET',
    `${management}&scope=headquarters&deptId=4&keyword=sunrise&status=0`,
  );
  assert.equal(bossPage.total, 1);
  assert.equal(bossPage.list[0].username, 'sunrise');
  assert.equal(bossPage.list[0].status, 0);
  assert.equal(bossPage.list[0].readOnly, true);
  assert.deepEqual(
    bossPage.list[0].identities.map(({ deptId, deptName, roleNames }) => [
      deptId,
      deptName,
      roleNames,
    ]),
    [[4, '老板', '老板']],
  );
  for (const url of [
    '/users?keyword=sunrise',
    `${management}&deptId=1&keyword=sunrise`,
    `${management}&keyword=mango`,
  ])
    assert.equal((await h.call<Page>(mango, 'GET', url)).total, 0);
  const manager = await h.actor('website', 'BUSINESS_MANAGER');
  assert.equal(
    (await h.call<Page>(manager, 'GET', `${management}&keyword=sunrise`)).total,
    0,
  );
  await h.call(
    mango,
    'GET',
    `/users/${sunrise.id}`,
    undefined,
    404,
    'USER_NOT_FOUND',
  );
  await h.call(
    mango,
    'DELETE',
    `/users?ids=${sunrise.id}`,
    undefined,
    404,
    'USER_NOT_FOUND',
  );

  await h.call(
    sunrise,
    'GET',
    '/auth/me',
    undefined,
    401,
    'AUTH_TOKEN_INVALID',
  );
  // Re-enable only the disposable test account to exercise the same JWT.
  await h.db.query("UPDATE users SET status='enabled' WHERE id=$1", [
    sunrise.id,
  ]);

  const me = await h.call<{
    roles: string[];
    permissions: string[];
    menuKeys: string[];
  }>(sunrise, 'GET', '/auth/me');
  assert.deepEqual(me.roles, ['BOSS']);
  assert(
    !me.permissions.some((permission) => permission.startsWith('whatsapp:')),
  );
  for (const key of blockedMenus) assert(!me.menuKeys.includes(key));
  for (const permission of [
    'inquiry:delete',
    'tour:rating:update',
    'ledger:direct:create',
  ])
    assert(me.permissions.includes(permission), permission);

  for (const endpoint of [
    '/whatsapp/conversations',
    '/whatsapp/summary',
    '/whatsapp/quick-replies',
    '/whatsapp/quick-replies/manage',
    '/whatsapp/integration',
    '/system/operation-logs',
    path,
  ]) {
    await h.call(sunrise, 'GET', endpoint, undefined, 403, 'AUTH_FORBIDDEN');
  }
  await h.call(sunrise, 'GET', '/inquiries');
  await h.call(sunrise, 'GET', '/website/inquiries');
  const navigation = await h.call<{
    groups: { children: { menuKey: string }[] }[];
  }>(sunrise, 'GET', `${path}/navigation`);
  const visible = navigation.groups.flatMap((group) =>
    group.children.map((item) => item.menuKey),
  );
  for (const key of blockedMenus) assert(!visible.includes(key));

  const { roles } = await h.call<{ roles: RoleMenuConfig[] }>(
    mango,
    'GET',
    path,
  );
  assert(!roles.some((role) => role.code === 'SUNRISE'));
  const boss = roles.find((role) => role.code === 'BOSS');
  assert(boss?.locked);
  assert.equal(boss.name, '老板');
  for (const key of blockedMenus) assert(!boss.allowedMenuKeys.includes(key));
  await h.call(
    mango,
    'PUT',
    `${path}/BOSS`,
    {
      version: boss.version,
      menuKeys: ['operations'],
    },
    400,
    'VALIDATION_ERROR',
  );
  await h.call(
    mango,
    'PUT',
    `${path}/SUNRISE`,
    {
      version: 2,
      menuKeys: ['operations'],
    },
    404,
    'NOT_FOUND',
  );
  await h.call(mango, 'GET', '/whatsapp/conversations');
  await h.call(mango, 'GET', '/system/operation-logs');
  assert.deepEqual(
    (await h.call<{ roles: string[] }>(mango, 'GET', '/auth/me')).roles,
    ['ROOT'],
  );
  console.log(
    `PASS Headquarters Boss: ${h.requests} HTTP checks, role upgrade and repeat migration`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => h.close());
