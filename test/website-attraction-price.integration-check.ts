/** Disposable local PostgreSQL: upgrade preservation and real configuration HTTP paths. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IsolationHarness } from './business-isolation.harness';
import { AddWebsiteAttractionPrice1795564800000 } from '../src/migrations/1795564800000-AddWebsiteAttractionPrice';
import { validateWebsiteConfig } from '../src/website/website-engine';
import type {
  WebsiteAttraction,
  WebsiteConfig,
} from '../src/website/website.types';

const h = new IsolationHarness();
async function main() {
  try {
    await h.start();
    assert.equal((await h.db.runMigrations()).length, 0);
    const editor = await h.actor('website', 'RESOURCE_MANAGER');
    const foreign = await h.actor('linxi', 'RESOURCE_MANAGER');
    const base = await h.call<WebsiteConfig>(editor, 'GET', '/website/config');
    const city = {
      id: randomUUID(),
      status: 'enabled' as const,
      nameZh: '价格测试城市',
      nameEn: 'Price city',
      resourceId: null,
    };
    const attraction: WebsiteAttraction = {
      id: randomUUID(),
      status: 'enabled',
      cityId: city.id,
      parentId: null,
      nameZh: '价格测试景点',
      nameEn: 'Price attraction',
      resourceId: null,
      kind: 'attraction',
      chargeable: true,
      price: '0.00',
      descriptionZh: '景点说明',
      descriptionEn: 'Attraction description',
      recommendedMonths: [],
    };
    let config = await h.call<WebsiteConfig>(editor, 'PUT', '/website/config', {
      ...base,
      cities: [city],
      attractions: [
        attraction,
        { ...attraction, id: randomUUID(), chargeable: false },
      ],
    });
    const oldVersion = config.version;
    for (const price of ['0', '12.34', '9999999999.99']) {
      const saved = await h.call<{ version: number }>(
        editor,
        'PUT',
        `/website/config/attractions/${attraction.id}`,
        {
          version: config.version,
          record: { ...attraction, price },
        },
      );
      config = await h.call<WebsiteConfig>(editor, 'GET', '/website/config');
      assert.equal(config.version, saved.version);
      assert.equal(config.attractions[0].price, price);
    }
    for (const price of [
      '',
      ' ',
      '-1',
      '1.234',
      '10000000000',
      'NaN',
      null,
      undefined,
      0,
    ]) {
      await h.call(
        editor,
        'PUT',
        `/website/config/attractions/${attraction.id}`,
        {
          version: config.version,
          record: { ...attraction, price },
        },
        400,
        'VALIDATION_ERROR',
      );
      await h.call(
        editor,
        'PUT',
        '/website/config',
        {
          ...config,
          attractions: [{ ...attraction, price }],
        },
        400,
        'VALIDATION_ERROR',
      );
      assert.throws(() =>
        validateWebsiteConfig({
          ...config,
          attractions: [{ ...attraction, price } as WebsiteAttraction],
        }),
      );
    }
    await h.call(
      foreign,
      'GET',
      `/website/config?version=${oldVersion}`,
      undefined,
      404,
      'NOT_FOUND',
    );
    assert.equal(
      (
        await h.call<WebsiteConfig>(
          editor,
          'GET',
          `/website/config?version=${oldVersion}`,
        )
      ).attractions[0].price,
      '0.00',
    );
    await h.db.query(
      `UPDATE website_config_versions v SET config=jsonb_set(config,'{attractions}',
      (SELECT jsonb_agg(a.item-'price' ORDER BY a.position)
       FROM jsonb_array_elements(v.config->'attractions') WITH ORDINALITY a(item,position)))
      WHERE business_unit='website' AND version<>$1 AND jsonb_array_length(config->'attractions')>0`,
      [config.version],
    );
    const before = await h.db.query<
      Array<{ version: number; config: WebsiteConfig }>
    >('SELECT version,config FROM website_config_versions ORDER BY version');
    const currentBefore = await h.db.query<unknown[]>(
      'SELECT * FROM website_config_current ORDER BY business_unit',
    );
    const runner = h.db.createQueryRunner();
    await runner.connect();
    try {
      const migration = new AddWebsiteAttractionPrice1795564800000();
      await migration.up(runner);
      await migration.up(runner);
    } finally {
      await runner.release();
    }
    const after = await h.db.query<typeof before>(
      'SELECT version,config FROM website_config_versions ORDER BY version',
    );
    assert.deepEqual(
      after,
      before.map((row) => ({
        ...row,
        config: {
          ...row.config,
          attractions: row.config.attractions.map((item) => ({
            ...item,
            price: item.price ?? '0.00',
          })),
        },
      })),
    );
    assert.deepEqual(
      await h.db.query(
        'SELECT * FROM website_config_current ORDER BY business_unit',
      ),
      currentBefore,
    );
    const migrated = await h.call<WebsiteConfig>(
      editor,
      'GET',
      `/website/config?version=${oldVersion}`,
    );
    assert(migrated.attractions.every((item) => item.price === '0.00'));
    const page = await h.call<{ list: WebsiteAttraction[] }>(
      editor,
      'GET',
      `/website/config/attractions?version=${oldVersion}`,
    );
    assert.deepEqual(page.list, migrated.attractions);
    console.log(
      `PASS: price zero/decimals/bounds/rejection/history/isolation and lossless idempotent upgrade; ${h.requests} HTTP checks`,
    );
  } finally {
    await h.close();
  }
}
void main();
