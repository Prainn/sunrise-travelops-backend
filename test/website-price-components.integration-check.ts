/** Disposable localhost PostgreSQL only; never reads .env/business credentials. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IsolationHarness } from './business-isolation.harness';
import { WEBSITE_PRICE_CATEGORIES } from '../src/website/website-price';
import type {
  WebsiteConfig,
  WebsiteInquiry,
  WebsiteItinerary,
  WebsiteItineraryInput,
  WebsitePreview,
  WebsiteQuotation,
} from '../src/website/website.types';
const h = new IsolationHarness();
async function main() {
  try {
    await h.start();
    assert.equal((await h.db.runMigrations()).length, 0);
    const editor = await h.actor('website', 'RESOURCE_MANAGER');
    const owner = await h.actor('website');
    const foreign = await h.actor('linxi');
    let config = await h.call<WebsiteConfig>(editor, 'GET', '/website/config');
    const cityId = randomUUID();
    config = await h.call<WebsiteConfig>(editor, 'PUT', '/website/config', {
      ...config,
      cities: [
        {
          id: cityId,
          nameZh: '昆明',
          nameEn: 'Kunming',
          resourceId: null,
          status: 'enabled',
        },
      ],
      templates: [
        'arrival-basic',
        'departure-basic',
        'guide',
        'private-driver',
        'hsr-second-class',
        'included-service',
        'optional-not-included',
        'peak-season',
        'hotel-substitution',
        'no-shopping',
      ].map((code) => ({
        id: randomUUID(),
        name: code,
        code,
        status: 'enabled',
        zh: '测试文案',
        en: 'Fixture.',
      })),
    });
    const [country] = await h.db.query<{ id: string }[]>(
      `SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' AND i.status='enabled' LIMIT 1`,
    );
    let inquiry = await h.call<WebsiteInquiry>(
      owner,
      'POST',
      '/website/inquiries',
      {
        countryItemId: country.id,
        customerName: 'Component test',
        plannedDays: 1,
        requirements: 'Disposable test',
      },
      201,
    );
    const input: WebsiteItineraryInput = {
      configVersion: config.version,
      title: 'Component test',
      duration: 1,
      startDate: null,
      pax: 2,
      arrivalTime: '',
      departureTime: '',
      vehiclePrices: [
        {
          vehicleType: null,
          hotelTier: null,
          unitPrice: '123.45',
        },
      ],
      days: [
        {
          id: randomUUID(),
          dayNumber: 1,
          departCityId: cityId,
          endCityId: cityId,
          overnightCityId: null,
          items: [],
          legs: [],
          hotels: [],
          meals: [],
          guideLanguage: '',
          services: [],
        },
      ],
    };
    let plan = await h.call<WebsiteItinerary>(
      owner,
      'POST',
      `/website/inquiries/${inquiry.id}/itineraries`,
      { ...input, inquiryVersion: inquiry.version },
      201,
    );
    // Reconstruct predecessor only inside the disposable database.
    await h.db.query(
      `INSERT INTO website_vehicle_prices(itinerary_id,vehicle_type,plan,includes_driver,includes_guide,unit_price) VALUES($1,'7_seat','A',true,false,123.45)`,
      [plan.id],
    );
    await h.db.query('DROP TABLE website_price_components');
    await h.db.query('DELETE FROM migrations WHERE name=$1', [
      'WebsitePriceComponents1794787200000',
    ]);
    const legacySnapshot = {
      schemaVersion: 3,
      english: {
        quotation: [{ vehicle: '7-seat vehicle', price: 'RMB 123.45 PP' }],
      },
    };
    await h.db.query(
      `INSERT INTO website_quotations(id,itinerary_id,code,snapshot,confirmed_at,confirmed_by) VALUES($1,$2,'WQT-COMPONENT-LEGACY',$3,now(),$4)`,
      [randomUUID(), plan.id, JSON.stringify(legacySnapshot), owner.id],
    );
    assert.equal((await h.db.runMigrations()).length, 1);
    assert.equal((await h.db.runMigrations()).length, 0);
    plan = await h.call<WebsiteItinerary>(
      owner,
      'GET',
      `/website/itineraries/${plan.id}`,
    );
    assert.equal(plan.previousPlanPrices?.[0].unitPrice, '123.45');
    assert.equal(plan.previousPlanPrices?.[0].plan, 'A');
    assert.equal(plan.vehiclePrices[0].unitPrice, '123.45');
    assert.deepEqual(plan.vehiclePrices[0].priceComponents, []);
    const [snapshot] = await h.db.query<{ snapshot: unknown }[]>(
      'SELECT snapshot FROM website_quotations WHERE itinerary_id=$1',
      [plan.id],
    );
    assert.deepEqual(snapshot.snapshot, legacySnapshot);
    await h.db.query('DELETE FROM website_quotations WHERE itinerary_id=$1', [
      plan.id,
    ]);
    const values = ['2000', '1000', '3000', '2000', '2000'];
    input.vehiclePrices[0].priceComponents = WEBSITE_PRICE_CATEGORIES.map(
      (category, index) => ({
        category,
        unitPrice: values[index],
        showInPdf: category === 'hotel' || category === 'attraction',
      }),
    );
    input.vehiclePrices[0].unitPrice = '1';
    plan = await h.call<WebsiteItinerary>(
      owner,
      'PUT',
      `/website/itineraries/${plan.id}`,
      { ...input, version: plan.version },
    );
    assert.equal(plan.vehiclePrices[0].unitPrice, '10000.00');
    assert.equal(plan.vehiclePrices[0].priceComponents?.length, 5);
    assert.deepEqual(
      await h.call<WebsiteItinerary>(
        owner,
        'GET',
        `/website/itineraries/${plan.id}`,
      ),
      plan,
    );
    await h.call(
      foreign,
      'GET',
      `/website/itineraries/${plan.id}`,
      undefined,
      404,
      'INQUIRY_NOT_FOUND',
    );
    for (const bad of [
      input.vehiclePrices[0].priceComponents.slice(1),
      Array.from(
        { length: 5 },
        () => input.vehiclePrices[0].priceComponents![0],
      ),
      input.vehiclePrices[0].priceComponents.map((row) => ({
        ...row,
        unitPrice: '-1',
      })),
      input.vehiclePrices[0].priceComponents.map((row) => ({
        ...row,
        unitPrice: '9999999999.99',
      })),
    ]) {
      await h.call(
        owner,
        'PUT',
        `/website/itineraries/${plan.id}`,
        {
          ...input,
          vehiclePrices: [{ ...input.vehiclePrices[0], priceComponents: bad }],
          version: plan.version,
        },
        400,
        bad.some((row) => row.unitPrice === '-1')
          ? 'VALIDATION_ERROR'
          : 'ITINERARY_INVALID',
      );
    }
    const copied = await h.call<WebsiteItinerary>(
      owner,
      'POST',
      `/website/itineraries/${plan.id}/copy`,
      { version: plan.version },
      201,
    );
    assert.deepEqual(copied.vehiclePrices, plan.vehiclePrices);
    const preview = await h.call<WebsitePreview>(
      owner,
      'GET',
      `/website/itineraries/${plan.id}/preview`,
    );
    assert.deepEqual(
      preview.issues.filter((issue) => issue.severity === 'ERROR'),
      [],
    );
    inquiry = await h.call<WebsiteInquiry>(
      owner,
      'GET',
      `/website/inquiries/${inquiry.id}`,
    );
    const quotation = await h.call<WebsiteQuotation>(
      owner,
      'POST',
      `/website/itineraries/${plan.id}/confirm`,
      {
        version: plan.version,
        inquiryVersion: inquiry.version,
        acknowledgedWarnings: [
          ...new Set(
            preview.issues
              .filter((issue) => issue.severity === 'WARNING')
              .map((issue) => issue.code),
          ),
        ],
      },
      201,
    );
    assert.equal(quotation.schemaVersion, 5);
    for (const output of [quotation.chinese, quotation.english]) {
      const row = output.quotation[0];
      assert.equal(row.unitPrice, '10000.00');
      assert.equal(row.totalPrice, '20000.00');
      assert.deepEqual(
        row.priceComponents?.map((item) => item.category).sort(),
        ['attraction', 'hotel'],
      );
    }
    await h.call(owner, 'PUT', `/website/itineraries/${copied.id}`, {
      ...input,
      version: copied.version,
      days: copied.days,
      vehiclePrices: [
        {
          ...input.vehiclePrices[0],
          priceComponents: input.vehiclePrices[0].priceComponents.map(
            (row) => ({ ...row, unitPrice: '0', showInPdf: false }),
          ),
        },
      ],
    });
    assert.deepEqual(
      await h.call(owner, 'GET', `/website/itineraries/${plan.id}/quotation`),
      quotation,
    );
    await assert.rejects(
      h.db.undoLastMigration(),
      /Hotel-tier quotation data prevents rollback/,
    );
    console.log(
      `Price components: fresh/repeated/legacy migrations, save/copy/freeze, visibility and isolation passed (${h.requests} API calls)`,
    );
  } finally {
    await h.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
