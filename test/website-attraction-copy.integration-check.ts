/** Disposable localhost PostgreSQL only; exercises migration and the actual HTTP/save path. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IsolationHarness } from './business-isolation.harness';
import { WebsiteAttractionDirectCopy1795478400000 } from '../src/migrations/1795478400000-WebsiteAttractionDirectCopy';
import type {
  WebsiteConfig,
  WebsiteInquiry,
  WebsiteItinerary,
} from '../src/website/website.types';

const h = new IsolationHarness();
async function main() {
  try {
    await h.start();
    assert.equal((await h.db.runMigrations()).length, 0);
    const editor = await h.actor('website', 'RESOURCE_MANAGER');
    const owner = await h.actor('website');
    const base = await h.call<WebsiteConfig>(editor, 'GET', '/website/config');
    const city = {
      id: randomUUID(),
      status: 'enabled',
      nameZh: '城市',
      nameEn: 'City',
      resourceId: null,
    };
    const attraction = {
      id: randomUUID(),
      status: 'enabled',
      cityId: city.id,
      parentId: null,
      nameZh: '景点',
      nameEn: 'Attraction',
      kind: 'attraction',
      resourceId: null,
      chargeable: false,
      recommendedMonths: [],
      descriptionZh: '参观{city}的{attraction}。',
      descriptionEn: 'Visit {attraction} in {city}.',
    };
    const config = await h.call<WebsiteConfig>(
      editor,
      'PUT',
      '/website/config',
      {
        ...base,
        cities: [city],
        attractions: [attraction],
        templates: [],
      },
    );
    await h.call(
      editor,
      'PUT',
      `/website/config/attractions/${attraction.id}`,
      {
        version: config.version,
        record: { ...attraction, copyKey: 'old-code' },
      },
      400,
      'VALIDATION_ERROR',
    );
    const country = await h.db.query<{ id: string }[]>(
      "SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' AND i.status='enabled' LIMIT 1",
    );
    const inquiry = await h.call<WebsiteInquiry>(
      owner,
      'POST',
      '/website/inquiries',
      {
        countryItemId: country[0].id,
        customerName: '直接文案隔离测试',
        plannedDays: 1,
        requirements: 'Test',
      },
      201,
    );
    const day = {
      id: randomUUID(),
      dayNumber: 1,
      departCityId: city.id,
      endCityId: city.id,
      overnightCityId: null,
      guideLanguage: '',
      legs: [],
      hotels: [],
      meals: [],
      services: [],
      eventOrder: [],
      items: [
        {
          id: randomUUID(),
          attractionId: attraction.id,
          nameZh: '客户端覆盖',
          nameEn: 'Override',
          descriptionZh: '不能覆盖',
          descriptionEn: 'Must not override',
          appears: true,
          feeState: 'INCLUDED',
        },
      ],
    };
    const plan = await h.call<WebsiteItinerary>(
      owner,
      'POST',
      `/website/inquiries/${inquiry.id}/itineraries`,
      {
        inquiryVersion: inquiry.version,
        configVersion: config.version,
        title: 'Test',
        duration: 1,
        days: [day],
      },
      201,
    );
    assert.equal(plan.days[0].items[0].descriptionZh, attraction.descriptionZh);
    assert.equal(plan.days[0].items[0].descriptionEn, attraction.descriptionEn);
    assert.equal(plan.days[0].items[0].nameZh, attraction.nameZh);

    // Simulate two historical versions with a shared template. No application fallback is used.
    const template = {
      id: randomUUID(),
      name: '旧正文',
      code: 'old-copy',
      status: 'enabled',
      zh: attraction.descriptionZh,
      en: attraction.descriptionEn,
    };
    const legacyAttraction: Record<string, unknown> = {
      ...attraction,
      copyKey: template.code,
    };
    delete legacyAttraction.descriptionZh;
    delete legacyAttraction.descriptionEn;
    const legacy = {
      ...config,
      attractions: [
        legacyAttraction,
        {
          ...legacyAttraction,
          id: randomUUID(),
          kind: 'component',
          parentId: attraction.id,
        },
      ],
      templates: [template],
    };
    await h.db.query(
      'UPDATE website_config_versions SET config=$2 WHERE version=$1',
      [config.version, legacy],
    );
    const [{ version: historicalVersion }] = await h.db.query<
      { version: number }[]
    >(
      "INSERT INTO website_config_versions(version,business_unit,config) VALUES(nextval('website_config_version_seq'),'website',$1) RETURNING version",
      [legacy],
    );
    const beforePlan = await h.db.query<unknown[]>(
      'SELECT * FROM website_items',
    );
    const snapshot = {
      schemaVersion: 6,
      english: { itinerary: [{ sightseeing: 'Frozen original' }] },
      config: legacy,
    };
    await h.db.query(
      'INSERT INTO website_quotations(id,itinerary_id,code,snapshot,confirmed_by) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), plan.id, 'COPY-TEST', snapshot, owner.id],
    );
    const migrate = async () =>
      h.db.transaction(async (manager) =>
        new WebsiteAttractionDirectCopy1795478400000().up(manager.queryRunner!),
      );
    await migrate();
    await migrate();
    assert.deepEqual(
      await h.db.query('SELECT * FROM website_items'),
      beforePlan,
    );
    assert.deepEqual(
      (
        await h.db.query<{ snapshot: unknown }[]>(
          'SELECT snapshot FROM website_quotations WHERE itinerary_id=$1',
          [plan.id],
        )
      )[0].snapshot,
      snapshot,
    );
    for (const version of [config.version, historicalVersion]) {
      const updated = await h.call<WebsiteConfig>(
        editor,
        'GET',
        `/website/config?version=${version}`,
      );
      assert.equal(updated.attractions.length, 2);
      for (const a of updated.attractions) {
        assert(!('copyKey' in a));
        assert.equal(a.descriptionZh, template.zh);
        assert.equal(a.descriptionEn, template.en);
      }
      assert.deepEqual(updated.templates, [template]);
    }
    // Changing an old standalone template cannot change the migrated attraction text.
    await h.db.query(
      "UPDATE website_config_versions SET config=jsonb_set(config,'{templates,0,zh}','\"独立模板修改\"'::jsonb) WHERE version=$1",
      [config.version],
    );
    const saved = await h.call<WebsiteItinerary>(
      owner,
      'PUT',
      `/website/itineraries/${plan.id}`,
      {
        version: plan.version,
        configVersion: config.version,
        title: plan.title,
        duration: 1,
        days: [day],
        vehiclePrices: [],
      },
    );
    assert.equal(
      saved.days[0].items[0].descriptionZh,
      attraction.descriptionZh,
    );
    assert.equal(
      saved.days[0].items[0].descriptionEn,
      attraction.descriptionEn,
    );
    // A missing/ambiguous source aborts the transaction instead of dropping text or guessing.
    await h.db.query(
      'UPDATE website_config_versions SET config=$2 WHERE version=$1',
      [historicalVersion, { ...legacy, templates: [] }],
    );
    await assert.rejects(migrate, /missing, ambiguous/);
    const rejected = await h.db.query<{ config: typeof legacy }[]>(
      'SELECT config FROM website_config_versions WHERE version=$1',
      [historicalVersion],
    );
    assert.equal(rejected[0].config.attractions[0].copyKey, 'old-copy');
    console.log(
      'PASS: full empty migration chain, repeat run, direct HTTP save, old-code rejection, historical/shared copy migration, frozen/item preservation, source independence and failed migration rollback',
    );
  } finally {
    await h.close();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
