/** Uses only the disposable localhost database created/dropped by IsolationHarness. */
import assert from 'node:assert/strict';
import { IsolationHarness, RecordRef } from './business-isolation.harness';
import { BoundResourceCodeSequences1795046400000 } from '../src/migrations/1795046400000-BoundResourceCodeSequences';

const h = new IsolationHarness();
async function run() {
  await h.start();
  assert.equal((await h.db.runMigrations()).length, 0);
  const root = await h.actor('headquarters', 'ROOT');
  const owner = await h.actor('shengxu');
  const other = await h.actor('shengxu');
  const linxi = await h.actor('linxi');
  const website = await h.actor('website');
  const cityBody = { name: '审查城市', province: '测试省', status: 'enabled' };
  const city = await h.call<RecordRef & { name: string; code: string }>(
    root,
    'POST',
    '/resources/cities',
    cityBody,
    201,
  );
  await h.call(
    root,
    'POST',
    '/resources/cities',
    { ...cityBody, id: city.id, name: '覆盖尝试' },
    400,
    'VALIDATION_ERROR',
  );
  assert.equal(
    (await h.call<typeof city>(root, 'GET', `/resources/cities/${city.id}`))
      .name,
    city.name,
  );
  await h.call(
    root,
    'PUT',
    `/resources/cities/${city.id}`,
    { ...cityBody, version: city.version + 1 },
    409,
    'RESOURCE_VERSION_CONFLICT',
  );
  const guide = await h.call(
    root,
    'POST',
    '/resources/guide-people',
    { name: '测试导游', status: 'enabled' },
    201,
  );
  await h.call(
    root,
    'POST',
    '/resources/guide-people',
    { id: guide.id, name: '覆盖尝试', status: 'disabled' },
    400,
    'VALIDATION_ERROR',
  );
  const [country] = await h.db.query<{ id: string }[]>(
    `SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' LIMIT 1`,
  );
  assert(country);
  const agency = await h.call(
    root,
    'POST',
    '/resources/agencies',
    {
      name: '测试社',
      status: 'enabled',
      city: '测试市',
      countryItemId: country.id,
      email: '',
      remark: '',
      businessUnit: 'shengxu',
      coordinatorId: owner.id,
    },
    201,
  );
  const child = await h.call<
    RecordRef & { parentName: string; shortName: string }
  >(
    root,
    'POST',
    '/resources/agencies',
    {
      name: '子社',
      parentId: agency.id,
      status: 'enabled',
      city: '测试市',
      countryItemId: country.id,
      email: '',
      remark: '',
      businessUnit: 'shengxu',
      coordinatorId: owner.id,
    },
    201,
  );
  assert.equal(child.parentName, '测试社');
  assert.equal(child.shortName, '子社');
  const contact = await h.call(
    owner,
    'POST',
    `/inquiries/contacts/${agency.id}`,
    { name: '联系人', phone: '' },
    201,
  );
  for (const actor of [linxi, website])
    await h.call(
      actor,
      'POST',
      `/inquiries/contacts/${agency.id}`,
      { name: '越界', phone: '' },
      403,
      'AUTH_FORBIDDEN',
    );
  await h.call(
    root,
    'POST',
    `/resources/agencies/${agency.id}/contacts`,
    { id: contact.id, name: '覆盖联系人', phone: '' },
    400,
    'VALIDATION_ERROR',
  );
  const inquiry = await h.call(
    owner,
    'POST',
    '/inquiries',
    {
      agencyId: agency.id,
      contactId: contact.id,
      countryItemId: country.id,
      sourceChannel: 'test',
      originalMessage: 'test',
      plannedDays: 1,
    },
    201,
  );
  await h.db.query(
    "UPDATE resource_agencies SET business_unit='linxi',coordinator_id=$2 WHERE id=$1",
    [agency.id, linxi.id],
  );
  await h.call(
    owner,
    'POST',
    `/inquiries/contacts/${agency.id}`,
    { name: '未绑定', phone: '' },
    400,
    'INQUIRY_CONTACT_INVALID',
  );
  await h.call(
    owner,
    'POST',
    `/inquiries/contacts/${agency.id}`,
    { name: '原社联系人', phone: '', inquiryId: inquiry.id },
    201,
  );
  await h.call(
    other,
    'POST',
    `/inquiries/contacts/${agency.id}`,
    { name: '他人询盘', phone: '', inquiryId: inquiry.id },
    404,
    'INQUIRY_NOT_FOUND',
  );
  console.log(
    'PASS resource INSERT, client-ID rejection, update version and contact scopes via real HTTP/SQL',
  );

  // Exercise this migration's old schema even after newer migrations are appended.
  const migration = new BoundResourceCodeSequences1795046400000();
  await h.db.transaction((manager) => migration.down(manager.queryRunner!));
  const [legacy] = await h.db.query<{ id: string }[]>(
    "INSERT INTO resource_cities(code,name,province) VALUES('CITY-9223372036854775808','旧超范围','测试') RETURNING id",
  );
  await assert.rejects(
    h.db.transaction((manager) => migration.up(manager.queryRunner!)),
  );
  const [unchanged] = await h.db.query<{ code: string }[]>(
    'SELECT code FROM resource_cities WHERE id=$1',
    [legacy.id],
  );
  assert.equal(unchanged.code, 'CITY-9223372036854775808');
  await h.db.query('DELETE FROM resource_cities WHERE id=$1', [legacy.id]);
  await h.db.transaction((manager) => migration.up(manager.queryRunner!));
  assert.equal((await h.db.runMigrations()).length, 0);
  assert.equal(
    (await h.call<typeof city>(root, 'GET', `/resources/cities/${city.id}`))
      .name,
    city.name,
  );
  await h.call(
    root,
    'POST',
    '/resources/cities',
    { ...cityBody, code: 'CITY-9223372036854775808' },
    400,
    'VALIDATION_ERROR',
  );
  await assert.rejects(
    h.db.query(
      "INSERT INTO resource_cities(code,name,province) VALUES('CITY-9223372036854775808','越界','测试')",
    ),
  );
  await h.call(
    root,
    'POST',
    '/resources/cities',
    { ...cityBody, name: '最大合法', code: 'CITY-999999999999999999' },
    201,
  );
  await h.call(root, 'GET', '/resources/cities');
  await h.call(
    root,
    'POST',
    '/resources/cities',
    { ...cityBody, name: '已耗尽' },
    409,
    'DATABASE_CONSTRAINT_VIOLATION',
  );
  console.log(
    'PASS empty/repeat migrations, representative old rows, unsafe legacy rejection without rewriting, safe sorting and controlled exhaustion',
  );
}
void run()
  .finally(() => h.close())
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
