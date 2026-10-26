import assert from 'node:assert/strict';
import { IsolationHarness, Page } from './business-isolation.harness';

const h = new IsolationHarness();

async function main() {
  try {
    await h.start();
    const admin = await h.actor('headquarters', 'ADMIN');
    const manager = await h.actor('shengxu', 'BUSINESS_MANAGER');
    const coordinator = await h.actor('shengxu');
    const resource = await h.actor('shengxu', 'RESOURCE_MANAGER');
    const linxi = await h.actor('linxi');
    const website = await h.actor('website');
    const mixed = await h.actor('shengxu');
    await h.actor('linxi', 'COORDINATOR', 'operation', mixed.id);
    for (const [actor, dept] of [
      [manager, 2],
      [coordinator, 3],
      [resource, 2],
      [mixed, 3],
      [linxi, 5],
      [website, 7],
    ] as const)
      await h.db.query('UPDATE user_identities SET dept_id=$2 WHERE id=$1', [
        actor.identityId,
        dept,
      ]);

    const shengxuIds = [manager.id, coordinator.id, resource.id, mixed.id];
    await h.page(admin, '/users?scope=shengxu', shengxuIds, 1);
    await h.page(admin, '/users?scope=shengxu&deptId=3', [
      coordinator.id,
      mixed.id,
    ]);
    await h.page(admin, '/users?scope=linxi', [linxi.id, mixed.id]);
    await h.page(admin, '/users?scope=website', [website.id]);
    await h.page(admin, '/users?scope=headquarters', [admin.id]);
    await h.page(admin, '/users', [
      admin.id,
      ...shengxuIds,
      linxi.id,
      website.id,
    ]);

    const result = await h.call<
      Omit<Page, 'list'> & {
        list: { id: string; identities: { scope: string }[] }[];
      }
    >(admin, 'GET', '/users?scope=shengxu');
    assert.deepEqual(
      result.list
        .find((user) => user.id === mixed.id)!
        .identities.map((identity) => identity.scope)
        .sort(),
      ['linxi', 'shengxu'],
    );
    await h.page(admin, '/users?scope=shengxu&coordinatorDuty=operation', []);
    await h.page(admin, '/users?scope=linxi&coordinatorDuty=operation', [
      mixed.id,
    ]);
    const [group] = await h.db.query<{ id: string }[]>(
      "INSERT INTO business_groups(name) VALUES('user-department-filter') RETURNING id",
    );
    await h.db.query(
      "UPDATE user_identities SET business_group_id=$2 WHERE user_id=$1 AND scope='linxi'",
      [mixed.id, group.id],
    );
    await h.page(admin, `/users?scope=shengxu&businessGroupId=${group.id}`, []);
    await h.page(admin, `/users?scope=linxi&businessGroupId=${group.id}`, [
      mixed.id,
    ]);

    // Business managers retain their existing same-business account boundary.
    await h.page(manager, '/users?scope=shengxu', [
      manager.id,
      coordinator.id,
      resource.id,
    ]);
    await h.call(
      manager,
      'GET',
      '/users?scope=website',
      undefined,
      403,
      'AUTH_FORBIDDEN',
    );
    await h.call(
      admin,
      'GET',
      '/users?scope=invalid',
      undefined,
      400,
      'VALIDATION_ERROR',
    );
    console.log(
      `PASS user department filtering: business/department, pagination, full identities, combined identity filters and access boundary (${h.requests} HTTP requests)`,
    );
  } finally {
    await h.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
