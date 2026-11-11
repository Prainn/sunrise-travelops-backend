/** Real session/guard/menu persistence checks against a disposable local PostgreSQL only. */
import assert from 'node:assert/strict';
import { IsolationHarness } from './business-isolation.harness';
import { RoleMenuConfig } from '../src/roles/menu-permissions.service';
import { AddSunriseMenuConfiguration1796256001000 } from '../src/migrations/1796256001000-AddSunriseMenuConfiguration';

const h = new IsolationHarness();
async function main() {
  await h.start();
  const mango = await h.actor('headquarters', 'ROOT', null, undefined, 'mango');
  // Upgrade an existing account without rewriting business/account rows.
  await h.db.transaction(async (manager) => {
    assert(manager.queryRunner);
    await new AddSunriseMenuConfiguration1796256001000().down(
      manager.queryRunner,
    );
    await manager.query('DELETE FROM migrations WHERE name=$1', [
      'AddSunriseMenuConfiguration1796256001000',
    ]);
  });
  assert.equal((await h.db.runMigrations()).length, 1);
  assert.equal((await h.db.runMigrations()).length, 0);
  assert.equal(
    (
      await h.db.query<{ id: string }[]>('SELECT id FROM users WHERE id=$1', [
        mango.id,
      ])
    )[0]?.id,
    mango.id,
  );
  const sunrise = await h.actor(
    'headquarters',
    'ROOT',
    null,
    undefined,
    'sunrise',
  );
  const root = await h.actor('headquarters', 'ROOT');
  const path = '/system/menu-permissions';
  const list = () => h.call<{ roles: RoleMenuConfig[] }>(mango, 'GET', path);
  const config = (await list()).roles.find((role) => role.code === 'SUNRISE')!;
  assert(
    config && !config.locked && config.menuKeys.includes('whatsapp-inbox'),
  );
  assert.equal(
    (await h.call<{ roles: RoleMenuConfig[] }>(root, 'GET', path)).roles.some(
      (role) => role.code === 'SUNRISE',
    ),
    false,
  );
  const save = (version: number, menuKeys: string[]) =>
    h.call<RoleMenuConfig>(mango, 'PUT', `${path}/SUNRISE`, {
      version,
      menuKeys,
    });
  await h.call(
    root,
    'PUT',
    `${path}/SUNRISE`,
    { version: 1, menuKeys: [] },
    403,
    'AUTH_FORBIDDEN',
  );
  await h.call(
    sunrise,
    'PUT',
    `${path}/SUNRISE`,
    { version: 1, menuKeys: [] },
    403,
    'AUTH_FORBIDDEN',
  );
  await h.call(
    mango,
    'PUT',
    `${path}/SUNRISE`,
    { version: 1, menuKeys: ['menu-permissions'] },
    400,
    'VALIDATION_ERROR',
  );
  const updated = await save(
    1,
    config.menuKeys.filter((key) => !key.startsWith('whatsapp-')),
  );
  assert.equal(updated.version, 2);
  await h.call(
    mango,
    'PUT',
    `${path}/SUNRISE`,
    { version: 1, menuKeys: [] },
    409,
    'CONFLICT',
  );
  // The same token issued before revocation is denied immediately.
  for (const endpoint of [
    '/whatsapp/conversations',
    '/whatsapp/quick-replies',
    '/whatsapp/integration',
  ]) {
    await h.call(sunrise, 'GET', endpoint, undefined, 403, 'AUTH_FORBIDDEN');
  }
  const me = await h.call<{ permissions: string[] }>(
    sunrise,
    'GET',
    '/auth/me',
  );
  assert(
    !me.permissions.some((permission) => permission.startsWith('whatsapp:')),
  );
  assert.equal(
    (await list()).roles.find((role) => role.code === 'SUNRISE')?.version,
    2,
  );
  const navigation = await h.call<{
    groups: { children: { menuKey: string }[] }[];
  }>(sunrise, 'GET', `${path}/navigation`);
  assert(
    !navigation.groups.some((group) =>
      group.children.some((item) => item.menuKey.startsWith('whatsapp-')),
    ),
  );
  await save(2, [
    'inquiry-summary',
    'website-inquiry-summary',
    'direct-ledger',
    'linxi-quote-summary',
  ]);
  // Shared read permissions cannot reopen separately disabled pages.
  for (const endpoint of [
    '/inquiries',
    '/website/inquiries',
    '/ledgers/direct?businessUnit=website',
    '/ledgers/summaries/website-quote-summary',
  ]) {
    await h.call(sunrise, 'GET', endpoint, undefined, 403, 'AUTH_FORBIDDEN');
  }
  await h.call(sunrise, 'GET', '/inquiry-logs/report');
  await save(3, config.menuKeys);
  const restored = await h.call<{ permissions: string[] }>(
    sunrise,
    'GET',
    '/auth/me',
  );
  assert(restored.permissions.includes('whatsapp:conversation:list'));
  assert(!restored.permissions.includes('sys:menu-permission:update'));
  const mangoMe = await h.call<{ permissions: string[] }>(
    mango,
    'GET',
    '/auth/me',
  );
  assert(mangoMe.permissions.includes('sys:menu-permission:update'));
  console.log(
    `PASS Sunrise menu permissions: ${h.requests} real HTTP requests, additive upgrade and repeat migration`,
  );
}
main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => h.close());
