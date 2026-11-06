/** Real HTTP with an independent disposable localhost database. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IsolationHarness } from './business-isolation.harness';
import type {
  WebsiteConfig,
  WebsiteDay,
  WebsiteInquiry,
  WebsiteItineraryResponse,
} from '../src/website/website.types';

const h = new IsolationHarness();
async function main() {
  try {
    await h.start();
    const editor = await h.actor('website', 'RESOURCE_MANAGER');
    const owner = await h.actor('website');
    const foreign = await h.actor('linxi');
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
      nameZh: '收费景点',
      nameEn: 'Paid attraction',
      resourceId: null,
      kind: 'attraction',
      chargeable: true,
      price: '12.30',
      descriptionZh: '说明',
      descriptionEn: 'Description',
      recommendedMonths: [],
    };
    const pattern = {
      id: randomUUID(),
      status: 'enabled',
      cityId: city.id,
      nameZh: '模板',
      nameEn: 'Pattern',
      attractionIds: [attraction.id],
    };
    const skeleton = {
      id: randomUUID(),
      status: 'enabled',
      nameZh: '骨架',
      nameEn: 'Skeleton',
      days: [{ cityId: city.id, patternId: pattern.id }],
    };
    const config = await h.call<WebsiteConfig>(
      editor,
      'PUT',
      '/website/config',
      {
        ...base,
        cities: [city],
        attractions: [attraction],
        patterns: [pattern],
        skeletons: [skeleton],
      },
    );
    const [country] = await h.db.query<Array<{ id: string }>>(
      "SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' AND i.status='enabled' LIMIT 1",
    );
    const inquiry = await h.call<WebsiteInquiry>(
      owner,
      'POST',
      '/website/inquiries',
      {
        countryItemId: country.id,
        customerName: '参考景点价格测试',
        plannedDays: 1,
        requirements: 'Test',
      },
      201,
    );
    const day: WebsiteDay = {
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
          nameZh: '收费景点',
          nameEn: 'Paid attraction',
          descriptionZh: '说明',
          descriptionEn: 'Description',
          appears: false,
          feeState: 'SELF_PAY',
        },
      ],
    };
    const input = {
      title: 'Reference',
      duration: 1,
      startDate: null,
      pax: 10,
      configVersion: config.version,
      days: [day],
      vehiclePrices: [],
    };
    const plan = await h.call<WebsiteItineraryResponse>(
      owner,
      'POST',
      `/website/inquiries/${inquiry.id}/itineraries`,
      { ...input, inquiryVersion: inquiry.version },
      201,
    );
    assert.equal(plan.attractionPriceReference.total, '12.30');
    assert.equal(
      plan.attractionPriceReference.items[0].itemId,
      day.items[0].id,
    );
    assert.equal(plan.attractionPriceReference.items[0].price, '12.30');
    await h.call(
      editor,
      'PUT',
      `/website/config/attractions/${attraction.id}`,
      { version: config.version, record: { ...attraction, price: '99.99' } },
    );
    const detail = await h.call<WebsiteItineraryResponse>(
      owner,
      'GET',
      `/website/itineraries/${plan.id}`,
    );
    assert.deepEqual(
      detail.attractionPriceReference,
      plan.attractionPriceReference,
    );
    const list = await h.call<WebsiteItineraryResponse[]>(
      owner,
      'GET',
      `/website/inquiries/${inquiry.id}/itineraries`,
    );
    assert.deepEqual(
      list[0].attractionPriceReference,
      plan.attractionPriceReference,
    );
    await h.call(
      foreign,
      'GET',
      `/website/itineraries/${plan.id}`,
      undefined,
      404,
      'INQUIRY_NOT_FOUND',
    );
    const saved = await h.call<WebsiteItineraryResponse>(
      owner,
      'PUT',
      `/website/itineraries/${plan.id}`,
      {
        ...input,
        version: plan.version,
        deletedDays: [
          {
            day: {
              ...day,
              id: randomUUID(),
              dayNumber: 2,
              items: [{ ...day.items[0], id: randomUUID() }],
            },
            originalDate: null,
          },
        ],
      },
    );
    assert.equal(saved.attractionPriceReference.items.length, 1);
    assert.equal(saved.attractionPriceReference.total, '12.30');
    await h.call(
      owner,
      'PUT',
      `/website/itineraries/${plan.id}`,
      {
        ...input,
        version: saved.version,
        attractionPriceReference: { total: '0.00' },
      },
      400,
      'VALIDATION_ERROR',
    );
    const copy = await h.call<WebsiteItineraryResponse>(
      owner,
      'POST',
      `/website/itineraries/${plan.id}/copy`,
      { version: saved.version },
      201,
    );
    assert.equal(copy.attractionPriceReference.total, '12.30');
    assert.notEqual(
      copy.attractionPriceReference.items[0].itemId,
      day.items[0].id,
    );
    await h.call(
      owner,
      'POST',
      `/website/itineraries/${copy.id}/generate`,
      { version: copy.version, skeletonId: skeleton.id },
      409,
      'CONFLICT',
    );
    const currentConfig = await h.call<WebsiteConfig>(
      editor,
      'GET',
      '/website/config',
    );
    const upgraded = await h.call<WebsiteItineraryResponse>(
      owner,
      'PUT',
      `/website/itineraries/${copy.id}`,
      {
        ...input,
        days: copy.days,
        version: copy.version,
        configVersion: currentConfig.version,
      },
    );
    assert.equal(upgraded.attractionPriceReference.total, '99.99');
    const generated = await h.call<WebsiteItineraryResponse>(
      owner,
      'POST',
      `/website/itineraries/${copy.id}/generate`,
      { version: upgraded.version, skeletonId: skeleton.id },
      201,
    );
    assert.equal(generated.attractionPriceReference.total, '99.99');
    const preview = await h.call<Record<string, unknown>>(
      owner,
      'GET',
      `/website/itineraries/${copy.id}/preview`,
    );
    assert(!Object.hasOwn(preview, 'attractionPriceReference'));
    assert(!JSON.stringify(preview).includes('attractionPriceReference'));
    console.log(
      `PASS: reference price create/list/detail/save/copy/generate, bound history, recycled days, request whitelist and isolation; ${h.requests} HTTP checks`,
    );
  } finally {
    await h.close();
  }
}
void main();
