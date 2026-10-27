/** Real account/session/permission/SQL checks in a disposable local database. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  Actor,
  IsolationHarness,
  Page,
  RecordRef,
} from './business-isolation.harness';
import { PERMISSION_DEFINITIONS } from '../src/auth/permissions';

const h = new IsolationHarness();
type Ledger = RecordRef & { capabilities: Record<string, boolean> };

async function reserved(username: string, root: Actor) {
  const id = randomUUID();
  await h.db.query(
    `INSERT INTO users(id,username,password_hash,nickname,english_name)
     SELECT $1,$2,password_hash,$2,$2 FROM users WHERE id=$3`,
    [id, username, root.id],
  );
  return h.actor('headquarters', 'ROOT', null, id);
}

async function run() {
  await h.start();
  const root = await h.actor('headquarters', 'ROOT');
  const sunrise = await reserved('sunrise', root);
  const mango = await reserved('mango', root);
  // These tokens carry the original full ROOT menu snapshot.
  const me = await h.call<{ permissions: string[] }>(
    sunrise,
    'GET',
    '/auth/me',
  );
  for (const permission of [
    'website:visit:list',
    'website:visit:export',
    'sys:menu-permission:list',
    'sys:menu-permission:update',
    'sys:account-link:manage',
    'sys:dict:create',
    'sys:dict:update',
    'sys:dict:delete',
    'sys:dict-item:create',
    'sys:dict-item:update',
    'sys:dict-item:delete',
    'sys:business-dictionary:create',
    'sys:business-dictionary:update',
    'sys:business-dictionary:delete',
  ])
    assert(!me.permissions.includes(permission));
  assert.deepEqual(
    (
      await h.call<{ permissions: string[] }>(mango, 'GET', '/auth/me')
    ).permissions.sort(),
    Object.keys(PERMISSION_DEFINITIONS).sort(),
  );
  const visible = async (actor: Actor) =>
    (
      await h.call<{ groups: { children: { menuKey: string }[] }[] }>(
        actor,
        'GET',
        '/system/menu-permissions/navigation',
      )
    ).groups.flatMap((g) => g.children.map((c) => c.menuKey));
  for (const key of ['menu-permissions', 'website-visits', 'account-links']) {
    assert(!(await visible(sunrise)).includes(key));
    assert((await visible(mango)).includes(key));
  }
  await h.call(
    sunrise,
    'GET',
    '/system/menu-permissions',
    undefined,
    403,
    'AUTH_FORBIDDEN',
  );
  await h.call(
    sunrise,
    'PUT',
    '/system/menu-permissions/ADMIN',
    { version: 1, menuKeys: [] },
    403,
    'AUTH_FORBIDDEN',
  );
  for (const permission of [
    'sys:user:list',
    'sys:user:create',
    'sys:user:update',
    'sys:user:delete',
    'sys:user:reset-password',
    'sys:dict:list',
    'sys:dict-item:list',
    'sys:business-dictionary:list',
  ])
    assert(me.permissions.includes(permission));
  for (const key of ['users', 'dict', 'business-dict'])
    assert((await visible(sunrise)).includes(key));
  await h.call(
    sunrise,
    'GET',
    '/system/account-links',
    undefined,
    403,
    'AUTH_FORBIDDEN',
  );
  await h.call(
    sunrise,
    'POST',
    '/system/account-links',
    {},
    403,
    'AUTH_FORBIDDEN',
  );
  await h.call(mango, 'GET', '/system/menu-permissions');
  // The owner cannot obtain mango's credentials or change its identity by ID.
  assert.equal(
    (await h.call<Page>(sunrise, 'GET', '/users?keyword=mango')).total,
    0,
  );
  await h.call(
    sunrise,
    'GET',
    `/users/${mango.id}`,
    undefined,
    404,
    'USER_NOT_FOUND',
  );
  await h.call(
    sunrise,
    'POST',
    `/users/${mango.id}/reset-password`,
    { password: 'CannotTakeOverMango1!' },
    404,
    'USER_NOT_FOUND',
  );
  await h.call(
    sunrise,
    'DELETE',
    `/users?ids=${mango.id}`,
    undefined,
    404,
    'USER_NOT_FOUND',
  );

  const [{ id: groupId }] = await h.db.query<{ id: string }[]>(
    'SELECT id FROM business_groups ORDER BY name LIMIT 1',
  );
  for (const unit of ['linxi', 'website'] as const) {
    const owner = await h.actor(unit);
    const operator = await h.actor(unit);
    const input = {
      receivedDate: '2030-01-01',
      source: 'reserved administrator check',
      operatorId: owner.id,
      ...(unit === 'linxi' ? { receivingGroupId: groupId } : {}),
    };
    const path = '/ledgers/direct';
    let row = await h.call<Ledger>(owner, 'POST', path, input, 201);
    const endpoint = `${path}/${row.id}`;
    assert.equal(
      (await h.call<Ledger>(sunrise, 'GET', endpoint)).capabilities.canEdit,
      false,
    );
    await h.unchanged(async () => {
      await h.call(
        sunrise,
        'PUT',
        endpoint,
        { ...input, version: row.version },
        403,
        'AUTH_FORBIDDEN',
      );
      await h.call(
        mango,
        'PUT',
        endpoint,
        { ...input, version: row.version + 10 },
        409,
        'LEDGER_VERSION_CONFLICT',
      );
    });
    const edit = {
      ...input,
      operatorId: operator.id,
      orderStatus: 'converted',
      proposalSent: true,
      loss: true,
      lossNote: 'test loss',
    };
    row = await h.call<Ledger>(mango, 'PUT', endpoint, {
      ...edit,
      version: row.version,
    });
    assert(row.capabilities.canReview);
    row = await h.call<Ledger>(mango, 'POST', `${endpoint}/review`, {
      version: row.version,
    });
    assert(!row.capabilities.canEdit);
    assert(row.capabilities.canOperate);
    await h.call(
      mango,
      'PUT',
      endpoint,
      { ...edit, version: row.version },
      409,
      'DIRECT_LEDGER_REVIEWED_READ_ONLY',
    );
    row = await h.call<Ledger>(mango, 'PUT', `${endpoint}/operation`, {
      version: row.version,
    });
    assert(!row.capabilities.canOperate);
    await h.call(
      mango,
      'DELETE',
      `${endpoint}?version=${row.version}`,
      undefined,
      409,
      'DIRECT_LEDGER_DELETE_REVIEWED',
    );
    const removable = await h.call<Ledger>(owner, 'POST', path, input, 201);
    await h.call(
      mango,
      'DELETE',
      `${path}/${removable.id}?version=${removable.version}`,
      undefined,
      204,
    );
  }

  const owner = await h.actor('shengxu');
  const agencyId = randomUUID(),
    contactId = randomUUID();
  await h.db.query(
    `INSERT INTO resource_agencies(id,code,name,business_unit,coordinator_id,country_or_region,city) VALUES($1,next_business_code('AGY'),'Reserved admin check','shengxu',$2,'','')`,
    [agencyId, owner.id],
  );
  await h.db.query(
    `INSERT INTO resource_agency_contacts(id,agency_id,name,name_key) VALUES($1,$2,'Test','test')`,
    [contactId, agencyId],
  );
  const input = {
    recordDate: '2030-01-01',
    agencyId,
    contactId,
    quotedGroups: 1,
    convertedGroups: 0,
  };
  let row = await h.call<Ledger>(owner, 'POST', '/ledgers/shengxu', input, 201);
  assert(
    (await h.call<Ledger>(mango, 'GET', `/ledgers/shengxu/${row.id}`))
      .capabilities.canEdit,
  );
  row = await h.call<Ledger>(mango, 'PUT', `/ledgers/shengxu/${row.id}`, {
    ...input,
    quotedGroups: 2,
    version: row.version,
  });
  await h.call(
    mango,
    'DELETE',
    `/ledgers/shengxu/${row.id}?version=${row.version}`,
    undefined,
    204,
  );
  row = await h.call<Ledger>(
    owner,
    'POST',
    '/ledgers/shengxu',
    { ...input, convertedGroups: 1 },
    201,
  );
  await h.call(
    mango,
    'DELETE',
    `/ledgers/shengxu/${row.id}?version=${row.version}`,
    undefined,
    409,
    'SHENGXU_LEDGER_DELETE_CONVERTED',
  );

  // Removing ROOT must revoke mango privileges even with the original token.
  await h.db.query(`DELETE FROM identity_roles WHERE identity_id=$1`, [
    mango.identityId,
  ]);
  await h.call(mango, 'GET', '/auth/me', undefined, 401, 'AUTH_TOKEN_INVALID');
  console.log(
    `Reserved administrator integration passed: ${h.requests} HTTP checks.`,
  );
}

void run()
  .finally(() => h.close())
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
