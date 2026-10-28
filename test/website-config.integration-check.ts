/** Uses only IsolationHarness's fresh database on disposable local PostgreSQL. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IsolationHarness } from './business-isolation.harness';
import type {
  WebsiteConfig,
  WebsiteConfigGroup,
  WebsiteConfigRecord,
  WebsiteConfigOption,
  WebsiteInquiry,
  WebsiteItinerary,
} from '../src/website/website.types';

const h = new IsolationHarness();
interface ConfigPage {
  version: number;
  list: WebsiteConfigRecord[];
  total: number;
  page: number;
  pageSize: number;
  references: Record<string, string>;
}
async function main() {
  try {
    await h.start();
    const editor = await h.actor('website', 'RESOURCE_MANAGER');
    const reader = await h.actor('website');
    const foreign = await h.actor('linxi', 'RESOURCE_MANAGER');
    const unrelated = await h.actor('shengxu', 'RESOURCE_MANAGER');
    const root = await h.actor('headquarters', 'ROOT');
    const base = await h.call<WebsiteConfig>(editor, 'GET', '/website/config');
    const cities = Array.from({ length: 24 }, (_, i) => ({
      id: randomUUID(),
      status: 'enabled' as const,
      nameZh: `城市${i}`,
      nameEn: `City ${i}`,
      resourceId: null,
    }));
    const fixture: WebsiteConfig = { ...base, cities };
    let current = await h.call<WebsiteConfig>(
      editor,
      'PUT',
      '/website/config',
      fixture,
    );
    const old = structuredClone(current);
    const country = await h.db.query<Array<{ id: string }>>(
      `SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' AND i.status='enabled' LIMIT 1`,
    );
    assert(country.length);
    const inquiry = await h.call<WebsiteInquiry>(
      reader,
      'POST',
      '/website/inquiries',
      {
        countryItemId: country[0].id,
        customerName: '分页历史引用测试',
        plannedDays: 1,
        requirements: '临时测试',
      },
      201,
    );
    const draft = await h.call<WebsiteItinerary>(
      reader,
      'POST',
      `/website/inquiries/${inquiry.id}/itineraries`,
      {
        inquiryVersion: inquiry.version,
        configVersion: old.version,
        title: '历史版本草稿',
        duration: 1,
      },
      201,
    );

    const page = await h.call<ConfigPage>(
      editor,
      'GET',
      '/website/config/cities?page=2&pageSize=10',
    );
    assert.equal(page.total, 24);
    assert.equal(page.version, current.version);
    assert.deepEqual(page.list, cities.slice(10, 20));
    assert.deepEqual(Object.keys(page).sort(), [
      'list',
      'page',
      'pageSize',
      'references',
      'total',
      'version',
    ]);
    assert.equal(
      (await h.call<ConfigPage>(editor, 'GET', '/website/config/cities?page=9'))
        .list.length,
      0,
    );
    const search = await h.call<ConfigPage>(
      editor,
      'GET',
      '/website/config/cities?keyword=cItY%202&pageSize=2',
    );
    assert.equal(search.total, 5); // 2,20,21,22,23
    assert.deepEqual(search.list, [cities[2], cities[20]]);
    assert.equal(
      (
        await h.call<ConfigPage>(
          editor,
          'GET',
          '/website/config/cities?keyword=%25',
        )
      ).total,
      0,
    );

    let version = current.version;
    const template = {
      id: randomUUID(),
      status: 'enabled' as const,
      name: '景点正文',
      code: 'custom-copy',
      zh: '{city}',
      en: '{city}',
    };
    const attraction = {
      id: randomUUID(),
      status: 'enabled' as const,
      cityId: cities[0].id,
      parentId: null,
      nameZh: '景点',
      nameEn: 'Attraction',
      resourceId: null,
      kind: 'attraction' as const,
      chargeable: true,
      copyKey: template.code,
      recommendedMonths: [1],
    };
    const records: Record<WebsiteConfigGroup, WebsiteConfigRecord> = {
      cities: { ...cities[0], id: randomUUID(), nameZh: '新城市' },
      templates: template,
      attractions: attraction,
      hotels: {
        id: randomUUID(),
        status: 'enabled',
        cityId: cities[0].id,
        nameZh: '酒店',
        nameEn: '',
        resourceId: null,
        price: '0',
      },
      routes: {
        id: randomUUID(),
        status: 'enabled',
        fromCityId: cities[0].id,
        toCityId: cities[1].id,
        vehicleOptions: [],
        nameZh: '路线',
        nameEn: 'Route',
        mode: 'hsr',
        feeState: 'INCLUDED',
      },
      patterns: {
        id: randomUUID(),
        status: 'enabled',
        cityId: cities[0].id,
        nameZh: '单日模板',
        nameEn: 'Pattern',
        attractionIds: [attraction.id],
      },
      skeletons: {
        id: randomUUID(),
        status: 'enabled',
        nameZh: '骨架',
        nameEn: 'Skeleton',
        days: [],
      },
    };
    const pattern = records.patterns;
    assert('cityId' in pattern);
    records.skeletons = {
      ...records.skeletons,
      days: [{ cityId: cities[0].id, patternId: pattern.id }],
    };
    const order: WebsiteConfigGroup[] = [
      'cities',
      'templates',
      'attractions',
      'hotels',
      'routes',
      'patterns',
      'skeletons',
    ];
    for (const group of order) {
      const saved = await h.call<{ version: number }>(
        editor,
        'POST',
        `/website/config/${group}`,
        { version, record: records[group] },
        201,
      );
      assert(saved.version > version);
      assert.deepEqual(Object.keys(saved), ['version']);
      version = saved.version;
      const listed = await h.call<ConfigPage>(
        editor,
        'GET',
        `/website/config/${group}?pageSize=100`,
      );
      assert(listed.list.some((row) => row.id === records[group].id));
      if (group === 'patterns') {
        assert.equal(listed.references[cities[0].id], cities[0].nameZh);
        assert.equal(listed.references[attraction.id], attraction.nameZh);
      }
    }
    current = await h.call<WebsiteConfig>(editor, 'GET', '/website/config');
    for (const group of order) {
      const before = structuredClone(current);
      const record = { ...records[group], status: 'disabled' };
      const saved = await h.call<{ version: number }>(
        editor,
        'PUT',
        `/website/config/${group}/${record.id}`,
        { version, record },
      );
      version = saved.version;
      current = await h.call<WebsiteConfig>(editor, 'GET', '/website/config');
      for (const other of order)
        if (other !== group) assert.deepEqual(current[other], before[other]);
      assert.equal(
        current[group].find((row) => row.id === record.id)?.status,
        'disabled',
      );
    }
    const options = await h.call<{
      list: WebsiteConfigOption[];
      total: number;
    }>(editor, 'GET', '/website/config/templates/options?pageSize=1');
    assert.deepEqual(options.list, [
      { id: template.id, value: template.code, label: template.code },
    ]);
    const filtered = await h.call<ConfigPage>(
      editor,
      'GET',
      `/website/config/attractions?cityId=${cities[0].id}&excludeId=${attraction.id}`,
    );
    assert.equal(filtered.total, 0);
    assert.deepEqual(
      (
        await h.call<ConfigPage>(
          editor,
          'GET',
          `/website/config/cities?version=${old.version}&pageSize=100`,
        )
      ).list,
      old.cities,
    );
    assert.equal(
      (await h.call<ConfigPage>(foreign, 'GET', '/website/config/cities'))
        .total,
      0,
    );

    const beforeRejected = await h.call<WebsiteConfig>(
      editor,
      'GET',
      '/website/config',
    );
    await h.call(
      editor,
      'DELETE',
      `/website/config/cities/${cities[0].id}`,
      { version },
      400,
      'VALIDATION_ERROR',
    );
    await h.call(
      editor,
      'PUT',
      `/website/config/attractions/${attraction.id}`,
      { version, record: { ...attraction, parentId: attraction.id } },
      400,
      'VALIDATION_ERROR',
    );
    for (const body of [
      {
        version,
        record: { ...cities[0], id: randomUUID(), extra: 'unexpected' },
      },
      { version, record: { ...cities[0], id: randomUUID(), nameZh: '' } },
      {
        version,
        record: { ...cities[0], id: randomUUID(), nameZh: { nested: true } },
      },
      { version: -1, record: cities[0] },
      { version, record: cities[0], extra: true },
    ])
      await h.call(
        editor,
        'POST',
        '/website/config/cities',
        body,
        400,
        'VALIDATION_ERROR',
      );
    await h.call(
      editor,
      'POST',
      '/website/config/cities',
      { version, record: { ...cities[0], id: template.id } },
      409,
      'CONFLICT',
    );
    await h.call(
      editor,
      'PUT',
      `/website/config/cities/${randomUUID()}`,
      { version, record: cities[0] },
      400,
      'VALIDATION_ERROR',
    );
    await h.call(
      editor,
      'DELETE',
      `/website/config/cities/${randomUUID()}`,
      { version },
      404,
      'NOT_FOUND',
    );
    await h.call(
      editor,
      'POST',
      '/website/config/cities',
      { version: old.version, record: { ...cities[0], id: randomUUID() } },
      409,
      'CONFLICT',
    );
    for (const path of [
      '/website/config/invalid',
      '/website/config/cities?pageSize=101',
      '/website/config/cities?page=0',
      '/website/config/cities?cityId=' + cities[0].id,
    ])
      await h.call(editor, 'GET', path, undefined, 400, 'VALIDATION_ERROR');
    await h.call(
      foreign,
      'GET',
      `/website/config/cities?version=${version}`,
      undefined,
      404,
      'NOT_FOUND',
    );
    await h.call(
      foreign,
      'GET',
      `/website/config/cities/options?version=${version}`,
      undefined,
      404,
      'NOT_FOUND',
    );
    await h.call(
      foreign,
      'POST',
      '/website/config/cities?businessUnit=website',
      { version, record: cities[0] },
      403,
      'AUTH_FORBIDDEN',
    );
    await h.call(
      unrelated,
      'GET',
      '/website/config/cities',
      undefined,
      403,
      'AUTH_FORBIDDEN',
    );
    await h.call(
      reader,
      'POST',
      '/website/config/cities',
      { version, record: cities[0] },
      403,
      'AUTH_FORBIDDEN',
    );
    await h.call(
      root,
      'GET',
      '/website/config/cities',
      undefined,
      400,
      'VALIDATION_ERROR',
    );
    assert.equal(
      (
        await h.call<ConfigPage>(
          root,
          'GET',
          '/website/config/cities?businessUnit=website',
        )
      ).total,
      25,
    );
    assert.deepEqual(
      await h.call(editor, 'GET', '/website/config'),
      beforeRejected,
    );

    // Identical read versions race through the real pointer row lock: only one commits.
    const writes = await Promise.allSettled(
      [1, 2].map((n) =>
        h.call<{ version: number }>(
          editor,
          'POST',
          '/website/config/cities',
          {
            version,
            record: { ...cities[0], id: randomUUID(), nameZh: `并发${n}` },
          },
          201,
        ),
      ),
    );
    assert.equal(writes.filter((r) => r.status === 'fulfilled').length, 1);
    const loser = writes.find((r) => r.status === 'rejected');
    assert(loser?.status === 'rejected');
    assert.match(String(loser.reason), /409|CONFLICT/);
    current = await h.call<WebsiteConfig>(editor, 'GET', '/website/config');
    assert.equal(current.cities.length, 26);
    version = current.version;

    for (const group of [...order].reverse()) {
      const saved = await h.call<{ version: number }>(
        editor,
        'DELETE',
        `/website/config/${group}/${records[group].id}`,
        { version },
      );
      version = saved.version;
    }
    assert.deepEqual(
      await h.call(editor, 'GET', `/website/config?version=${old.version}`),
      old,
    );
    const retainedDraft = await h.call<WebsiteItinerary>(
      reader,
      'GET',
      `/website/itineraries/${draft.id}`,
    );
    assert.deepEqual(retainedDraft, draft);
    assert.equal(retainedDraft.configVersion, old.version);
    const final = await h.call<WebsiteConfig>(editor, 'GET', '/website/config');
    assert.equal(final.cities.length, 25);
    for (const group of order.filter((g) => g !== 'cities'))
      assert.equal(final[group].length, 0);
    console.log(
      `PASS website config pagination, seven-group CRUD, filtering, references, validation, isolation, concurrent version conflict and historical itinerary (${h.requests} HTTP requests)`,
    );
  } finally {
    await h.close();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
