import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IsolationHarness, type Page } from './business-isolation.harness';
import type {
  WebsiteInquiry,
  WebsiteInquiryLog,
  WebsiteLogChange,
} from '../src/website/website.types';
import { captureLogNames } from '../src/website/website-log-history';

async function check() {
  const h = new IsolationHarness();
  try {
    await h.start();
    const owner = await h.actor('website'),
      other = await h.actor('linxi');
    const city = randomUUID(),
      restaurant = randomUUID();
    async function config(name: string) {
      const [row] = await h.db.query<{ version: number }[]>(
        "SELECT nextval('website_config_version_seq')::int AS version",
      );
      await h.db.query(
        "INSERT INTO website_config_versions(version,business_unit,config) SELECT $1,'website',v.config || $2::jsonb FROM website_config_versions v JOIN website_config_current c ON (v.business_unit,v.version)=(c.business_unit,c.version) WHERE c.business_unit='website'",
        [
          row.version,
          JSON.stringify({
            version: row.version,
            cities: [
              {
                id: city,
                status: 'enabled',
                nameZh: name,
                nameEn: 'Old City',
                resourceId: null,
              },
            ],
          }),
        ],
      );
      await h.db.query(
        "UPDATE website_config_current SET version=$1 WHERE business_unit='website'",
        [row.version],
      );
      return row.version;
    }
    const version = await config('旧城');
    const [country] = await h.db.query<{ id: string }[]>(
      "INSERT INTO system_business_dictionary_items(type_id,code,name,english_name) SELECT id,'MYS','马来西亚','Malaysia' FROM system_business_dictionary_types WHERE code='country-region' RETURNING id",
    );
    const inquiry = await h.call<WebsiteInquiry>(
      owner,
      'POST',
      '/website/inquiries',
      {
        plannedDays: 2,
        customerName: '测试',
        requirements: '日志测试',
        countryItemId: country.id,
        destinations: [city],
      },
      201,
    );
    const base = '/website/inquiry-logs?inquiryId=' + inquiry.id;
    await config('后来改名');
    async function page(query = '') {
      return h.call<Page<WebsiteInquiryLog>>(owner, 'GET', base + query);
    }
    let [created] = (await page()).list;
    assert.deepEqual(
      created.displayChanges?.find((c) => c.fields[0] === 'destinations')
        ?.after,
      [{ ref: 'city', nameZh: '旧城', nameEn: 'Old City' }],
    );
    assert(!('logNames' in created.metadata));
    assert(created.changes!.length > created.displayChanges.length);
    // Simulate the pre-display writer; the exact historical log remains immutable to the reader.
    await h.db.query(
      "UPDATE website_logs SET metadata=metadata-'logNames' WHERE id=$1",
      [created.id],
    );
    [created] = (await page()).list;
    assert.equal(JSON.stringify(created.displayChanges).includes('旧城'), true);
    assert.equal(
      JSON.stringify(created.displayChanges).includes('后来改名'),
      false,
    );
    const target = randomUUID(),
      d = randomUUID(),
      a = randomUUID(),
      b = randomUUID(),
      foreign = randomUUID();
    const add = (path: string, after: unknown): WebsiteLogChange => ({
      kind: 'added',
      path,
      before: null,
      after,
    });
    const edit = (
      path: string,
      before: unknown,
      after: unknown,
    ): WebsiteLogChange => ({ kind: 'changed', path, before, after });
    const prefix = 'days[' + d + ']';
    async function storeLog(
      day: number,
      changes: WebsiteLogChange[] | null,
      object = target,
    ) {
      const id = randomUUID();
      await h.db.query(
        "INSERT INTO website_logs(id,inquiry_id,action,target_id,target_type,actor_id,actor_name,occurred_at,changes) VALUES($1,$2,'itinerary_saved',$3,'itinerary',$4,'tester',$5,$6::jsonb)",
        [
          id,
          inquiry.id,
          object,
          owner.id,
          '2030-01-' + String(day).padStart(2, '0') + 'T01:00:00Z',
          changes === null ? null : JSON.stringify(changes),
        ],
      );
      return id;
    }
    await storeLog(1, [
      add('configVersion', version),
      add('days', [
        {
          id: d,
          dayNumber: 1,
          guideLanguage: '',
          legs: [],
          hotels: [],
          meals: [],
          services: [],
          eventOrder: [a, b],
          items: [
            { id: a, nameZh: '甲' },
            { id: b, nameZh: '乙' },
          ],
        },
      ]),
    ]);
    const ordered = await storeLog(2, [
      edit(prefix + '.eventOrder', [a, b], [b, a]),
      edit(prefix + '.items.order', [a, b], [b, a]),
      edit(prefix + '.endCityId', '', city),
    ]);
    await storeLog(3, [
      edit(prefix + '.items[' + a + '].nameZh', '甲', '以后的名字'),
    ]);
    await storeLog(
      4,
      [
        add('days', [
          { id: d, dayNumber: 8, items: [{ id: a, nameZh: '别的行程' }] },
        ]),
      ],
      foreign,
    );
    const noFields = await storeLog(5, null, foreign);
    const [old] = (await page('&page=4&pageSize=1&action=itinerary_saved'))
      .list;
    assert.equal(old.id, ordered);
    assert.equal(old.changes!.length, 3);
    assert.equal(old.displayChanges!.length, 2);
    assert.deepEqual(old.displayChanges![0].after, [
      { ref: 'item', nameZh: '乙' },
      { ref: 'item', nameZh: '甲' },
    ]);
    assert.deepEqual(old.displayChanges![1].after, {
      ref: 'city',
      nameZh: '旧城',
      nameEn: 'Old City',
    });
    const newest = (await page('&pageSize=1&action=itinerary_saved')).list[0];
    assert.equal(newest.id, noFields);
    assert.equal(newest.displayChanges, null);
    await h.call(other, 'GET', base, undefined, 404, 'INQUIRY_NOT_FOUND');
    const report = await h.call<{ changedFields: number }>(
      owner,
      'GET',
      '/website/inquiry-logs/report?inquiryId=' + inquiry.id,
    );
    assert.equal(
      report.changedFields,
      (await page('&pageSize=100')).list.reduce(
        (n, l) => n + (l.changes?.length ?? 0),
        0,
      ),
    );

    await h.db.query(
      "INSERT INTO resource_restaurants(id,code,name,city,description,price,unit,diner_count) VALUES($1,'RES-900','公共餐标','旧城','餐食',100,'table',3)",
      [restaurant],
    );
    const link = [
      edit(prefix + '.meals[' + a + '].resourceId', restaurant, null),
    ];
    const plan = {
      inquiryId: inquiry.id,
      configVersion: version,
      days: [
        {
          id: d,
          meals: [
            { id: a, resourceId: restaurant, restaurantZh: '自定义餐厅名' },
          ],
        },
      ],
    };
    const names = await captureLogNames(
      h.db.manager,
      link,
      'website',
      plan,
      plan,
    );
    assert.deepEqual(names!.before['restaurant:' + restaurant], {
      ref: 'restaurant',
      nameZh: '公共餐标',
    });
    console.log(
      'Website inquiry log HTTP and PostgreSQL integration passed. Creation, historical names, pagination, order, visibility, snapshots and statistics verified.',
    );
  } finally {
    await h.close();
  }
}
void check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
