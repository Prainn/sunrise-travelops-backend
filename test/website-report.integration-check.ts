/** Fresh database and representative upgrade, only on IsolationHarness's disposable localhost PG. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IsolationHarness } from './business-isolation.harness';
import type {
  WebsiteConfig,
  WebsiteInquiry,
  WebsiteItinerary,
  WebsiteItineraryInput,
  WebsitePreview,
  WebsiteQuotation,
  WebsiteRoute,
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
    const cities = ['昆明', '大理'].map((nameZh, i) => ({
      id: randomUUID(),
      nameZh,
      nameEn: ['Kunming', 'Dali'][i],
      resourceId: null,
      status: 'enabled' as const,
    }));
    config = await h.call<WebsiteConfig>(editor, 'PUT', '/website/config', {
      ...config,
      cities,
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
        en: 'Fixture copy.',
      })),
    });
    const [country] = await h.db.query<{ id: string }[]>(
      `SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' AND i.status='enabled' LIMIT 1`,
    );
    const inquiry = await h.call<WebsiteInquiry>(
      owner,
      'POST',
      '/website/inquiries',
      {
        countryItemId: country.id,
        customerName: 'Report fixture',
        plannedDays: 1,
        requirements: 'Disposable test',
      },
      201,
    );
    const input: WebsiteItineraryInput = {
      configVersion: config.version,
      title: 'Report fixture',
      duration: 1,
      startDate: null,
      pax: 3,
      arrivalTime: '',
      departureTime: '',

      vehiclePrices: [
        {
          vehicleType: '7_seat',
          plan: 'A',
          includesDriver: true,
          includesGuide: true,
          unitPrice: '123.45',
        },
      ],
      days: [
        {
          id: randomUUID(),
          dayNumber: 1,
          departCityId: cities[0].id,
          endCityId: cities[0].id,
          overnightCityId: null,
          items: [],
          legs: [],
          hotels: [],
          meals: [],
          guideLanguage: 'English',
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
    // Reconstruct the single-vehicle predecessor, without touching business databases.
    const legacyRoute = {
      id: randomUUID(),
      status: 'enabled',
      fromCityId: cities[0].id,
      toCityId: cities[1].id,
      mode: 'private_vehicle',
      nameZh: '旧路线',
      nameEn: 'Legacy route',
      feeState: 'INCLUDED',
      vehicleType: '7_seat',
      durationMinutes: 190,
      showInMileage: true,
    };
    await h.db.query(
      `UPDATE website_config_versions SET config=jsonb_set(config,'{routes}',$2::jsonb) WHERE version=$1`,
      [config.version, JSON.stringify([legacyRoute])],
    );
    await h.db.query('DELETE FROM migrations WHERE name=ANY($1::text[])', [
      [
        'WebsiteRouteVehicleOptions1794614400000',
        'WebsiteVehicleDurations1794700800000',
      ],
    ]);
    assert.equal(
      (await h.db.runMigrations())[0].name,
      'WebsiteRouteVehicleOptions1794614400000',
    );
    const converted = await h.call<WebsiteConfig>(
      editor,
      'GET',
      '/website/config',
    );
    assert.deepEqual(converted.routes[0].vehicleOptions, [
      { vehicleType: '7_seat', durationMinutes: 190 },
    ]);
    assert.equal(converted.routes[0].durationMinutes, null);
    assert(!('vehicleTypes' in converted.routes[0]));
    assert(!('vehicleType' in converted.routes[0]));
    assert(!('showInMileage' in converted.routes[0]));
    await h.db.query(
      `UPDATE website_config_versions SET config=jsonb_set(config,'{routes}','[]'::jsonb) WHERE version=$1`,
      [config.version],
    );
    // Reconstruct the immediate predecessor in this disposable database only.
    const migration = 'WebsiteTransportMileage1794528000000';
    const historical = {
      schemaVersion: 2,
      english: {
        mileage: [
          {
            route: 'Historical',
            distanceKm: '42',
            durationMinutes: 60,
            transport: 'Highway',
          },
        ],
      },
    };
    await h.db.query(
      `INSERT INTO website_quotations(id,itinerary_id,code,snapshot,confirmed_at,confirmed_by) VALUES($1,$2,'WQT-LEGACY',$3,now(),$4)`,
      [randomUUID(), plan.id, JSON.stringify(historical), owner.id],
    );
    await h.db.query(
      `ALTER TABLE website_legs DROP CONSTRAINT website_leg_vehicle_mode, DROP COLUMN vehicle_type, DROP COLUMN distance_km, DROP COLUMN duration_minutes, DROP COLUMN show_in_mileage`,
    );
    await h.db.query(
      `UPDATE website_config_versions c SET config=b.config FROM website_transport_mileage_backup b WHERE c.version=b.version`,
    );
    await h.db.query('DROP TABLE website_transport_mileage_backup');
    await h.db.query('DELETE FROM migrations WHERE name IN ($1,$2,$3)', [
      migration,
      'WebsiteRouteVehicleOptions1794614400000',
      'WebsiteVehicleDurations1794700800000',
    ]);
    const legacyId = randomUUID();
    const legacyLeg = randomUUID();
    const oldMileage = {
      id: legacyId,
      status: 'enabled',
      fromCityId: cities[0].id,
      toCityId: cities[0].id,
      mode: 'private_vehicle',
      distanceKm: '12.34',
      durationMinutes: 25,
    };
    await h.db.query(
      `UPDATE website_config_versions SET config=jsonb_set(config,'{mileages}',$2::jsonb) WHERE version=$1`,
      [config.version, JSON.stringify([oldMileage])],
    );
    await h.db.query(`INSERT INTO website_itinerary_mileages VALUES($1,$2,0)`, [
      plan.id,
      legacyId,
    ]);
    const insertLegacy = (id: string, position: number) =>
      h.db.query(
        `INSERT INTO website_legs(id,day_id,position,route_id,from_city_id,to_city_id,mode,name_zh,name_en,fee_state) VALUES($1,$2,$3,null,$4,$4,'private_vehicle','接送','Transfer','INCLUDED')`,
        [id, plan.days[0].id, position, cities[0].id],
      );
    await insertLegacy(legacyLeg, 0);
    const duplicateLeg = randomUUID();
    await insertLegacy(duplicateLeg, 1);
    await assert.rejects(h.db.runMigrations(), /cannot uniquely match/);
    // The failed transaction must leave the previous schema and authored selections intact.
    assert.equal(
      (
        await h.db.query<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM website_itinerary_mileages WHERE itinerary_id=$1`,
          [plan.id],
        )
      )[0].n,
      1,
    );
    await h.db.query('DELETE FROM website_legs WHERE id=$1', [duplicateLeg]);
    assert.equal((await h.db.runMigrations())[0].name, migration);
    assert.equal((await h.db.runMigrations()).length, 0);
    const upgraded = await h.call<WebsiteItinerary>(
      owner,
      'GET',
      `/website/itineraries/${plan.id}`,
    );
    assert.equal(upgraded.days[0].legs[0].distanceKm, '12.34');
    assert.equal(upgraded.days[0].legs[0].vehicleType, null);
    assert.equal(upgraded.days[0].legs[0].showInMileage, true);
    assert.deepEqual(
      (
        await h.db.query<{ snapshot: unknown }[]>(
          `SELECT snapshot FROM website_quotations WHERE itinerary_id=$1`,
          [plan.id],
        )
      )[0].snapshot,
      historical,
    );
    config = await h.call<WebsiteConfig>(editor, 'GET', '/website/config');
    assert.equal(
      config.routes.find((r) => r.id === legacyId)?.distanceKm,
      '12.34',
    );
    assert(!('mileages' in config));
    await h.db.query('DELETE FROM website_quotations WHERE itinerary_id=$1', [
      plan.id,
    ]);
    const routes: WebsiteRoute[] = [0, 1, 2].map((i) => ({
      id: randomUUID(),
      status: i === 2 ? 'disabled' : 'enabled',
      fromCityId: cities[i % 2].id,
      toCityId: cities[(i + 1) % 2].id,
      mode: i === 1 ? 'hsr' : 'private_vehicle',
      distanceKm: '320.5',
      durationMinutes: i === 1 ? 180 : null,
      vehicleOptions:
        i === 1
          ? []
          : [
              { vehicleType: '5_seat', durationMinutes: 180 },
              { vehicleType: '7_seat', durationMinutes: 210 },
              { vehicleType: '商务车', durationMinutes: null },
            ],
      nameZh: i === 1 ? '大理至昆明高铁' : '昆明至大理包车',
      nameEn:
        i === 1 ? 'Dali to Kunming train' : 'Kunming to Dali private vehicle',
      feeState: 'INCLUDED',
    }));
    config = await h.call<WebsiteConfig>(editor, 'PUT', '/website/config', {
      ...config,
      routes,
    });
    const page = await h.call<{ total: number; list: WebsiteRoute[] }>(
      owner,
      'GET',
      '/website/config/routes?keyword=Dali&status=enabled&pageSize=1&page=2',
    );
    assert.equal(page.total, 2);
    assert.equal(page.list[0].id, routes[1].id);
    await h.call(
      editor,
      'PUT',
      '/website/config',
      { ...config, routes: [{ ...routes[0], showInMileage: true }] },
      400,
      'VALIDATION_ERROR',
    );
    assert.deepEqual(config.routes[0].vehicleOptions, routes[0].vehicleOptions);
    const vehicleOptions = await h.call<{ list: { label: string }[] }>(
      owner,
      'GET',
      '/website/config/routes/options?keyword=商务车',
    );
    assert.match(vehicleOptions.list[0].label, /5座车.*7座车.*商务车/);
    for (const vehicleOptions of [
      [
        { vehicleType: '5_seat', durationMinutes: 180 },
        { vehicleType: ' 5_seat ', durationMinutes: 210 },
      ],
      [{ vehicleType: ' ', durationMinutes: null }],
      [{ vehicleType: 'x'.repeat(101), durationMinutes: null }],
      [{ vehicleType: '7_seat', durationMinutes: 0 }],
      [{ vehicleType: '7_seat', durationMinutes: 525601 }],
      [{ vehicleType: '7_seat', durationMinutes: 1.5 }],
    ]) {
      await h.call(
        editor,
        'PUT',
        '/website/config',
        { ...config, routes: [{ ...routes[0], vehicleOptions }] },
        400,
        'VALIDATION_ERROR',
      );
    }
    await h.call(
      editor,
      'PUT',
      '/website/config',
      {
        ...config,
        routes: [
          {
            ...routes[1],
            vehicleOptions: [{ vehicleType: '7_seat', durationMinutes: 210 }],
          },
        ],
      },
      400,
      'VALIDATION_ERROR',
    );

    const options = await h.call<{ list: { label: string }[] }>(
      owner,
      'GET',
      '/website/config/routes/options?keyword=hsr',
    );
    assert.match(options.list[0].label, /大理.*昆明/);
    assert.equal(
      (
        await h.call<{ total: number }>(
          foreign,
          'GET',
          '/website/config/routes',
        )
      ).total,
      0,
    );
    await h.call(
      foreign,
      'GET',
      `/website/itineraries/${plan.id}`,
      undefined,
      404,
      'INQUIRY_NOT_FOUND',
    );
    const saveInput = {
      ...input,
      configVersion: config.version,
      pax: null,
      days: [
        {
          ...input.days[0],
          legs: [routes[0], routes[1]].map((route, index) => ({
            id: randomUUID(),
            routeId: route.id,
            fromCityId: route.fromCityId,
            toCityId: route.toCityId,
            mode: route.mode,
            nameZh: route.nameZh,
            nameEn: route.nameEn,
            feeState: route.feeState,
            vehicleType: index === 0 ? '定制22座车' : null,
            distanceKm: index === 0 ? '0' : null,
            durationMinutes: index === 0 ? 120 : null,
            showInMileage: true,
          })),
        },
      ],
      vehiclePrices: [
        ...input.vehiclePrices,
        {
          vehicleType: '7_seat' as const,
          plan: 'B' as const,
          includesDriver: false,
          includesGuide: false,
          unitPrice: '0.00',
        },
      ],
    };
    plan = await h.call<WebsiteItinerary>(
      owner,
      'PUT',
      `/website/itineraries/${plan.id}`,
      { ...saveInput, version: plan.version },
    );
    assert.equal(plan.days[0].legs[0].distanceKm, '0.00');
    assert.equal(plan.days[0].legs[0].vehicleType, '定制22座车');
    assert.equal(plan.days[0].legs[1].distanceKm, null);
    const preview = await h.call<WebsitePreview>(
      owner,
      'GET',
      `/website/itineraries/${plan.id}/preview`,
    );
    assert(preview.issues.some((i) => i.code === 'VAL-E08'));
    assert.equal(preview.chinese.mileage?.[0].transport, '定制22座车');
    assert.equal(preview.english.mileage?.[0].transport, '定制22座车');
    let currentInquiry = await h.call<WebsiteInquiry>(
      owner,
      'GET',
      `/website/inquiries/${inquiry.id}`,
    );
    await h.call(
      owner,
      'POST',
      `/website/itineraries/${plan.id}/confirm`,
      {
        version: plan.version,
        inquiryVersion: currentInquiry.version,
        acknowledgedWarnings: [],
      },
      400,
      'PDF_NOT_READY',
    );
    await h.call(
      owner,
      'PUT',
      `/website/itineraries/${plan.id}`,
      {
        ...saveInput,
        version: plan.version,
        vehiclePrices: [input.vehiclePrices[0], input.vehiclePrices[0]],
      },
      400,
      'ITINERARY_INVALID',
    );
    await h.call(
      owner,
      'PUT',
      `/website/itineraries/${plan.id}`,
      {
        ...saveInput,
        version: plan.version,
        days: [
          {
            ...saveInput.days[0],
            legs: [{ ...saveInput.days[0].legs[0], distanceKm: '-1' }],
          },
        ],
      },
      400,
      'VALIDATION_ERROR',
    );
    plan = await h.call<WebsiteItinerary>(
      owner,
      'PUT',
      `/website/itineraries/${plan.id}`,
      { ...saveInput, pax: 3, version: plan.version },
    );
    const ready = await h.call<WebsitePreview>(
      owner,
      'GET',
      `/website/itineraries/${plan.id}/preview`,
    );
    assert.deepEqual(
      ready.issues.filter((i) => i.severity === 'ERROR'),
      [],
    );
    currentInquiry = await h.call<WebsiteInquiry>(
      owner,
      'GET',
      `/website/inquiries/${inquiry.id}`,
    );
    const quote = await h.call<WebsiteQuotation>(
      owner,
      'POST',
      `/website/itineraries/${plan.id}/confirm`,
      {
        version: plan.version,
        inquiryVersion: currentInquiry.version,
        acknowledgedWarnings: [
          ...new Set(
            ready.issues
              .filter((i) => i.severity === 'WARNING')
              .map((i) => i.code),
          ),
        ],
      },
      201,
    );
    assert.equal(quote.schemaVersion, 4);
    assert.deepEqual(
      quote.english.quotation.map((q) => [q.plan, q.totalPrice]),
      [
        ['A', '370.35'],
        ['B', '0.00'],
      ],
    );
    assert.deepEqual(
      quote.english.mileage?.map((m) => m.route),
      ['Kunming / Dali', 'Dali / Kunming'],
    );
    await h.call<WebsiteConfig>(editor, 'PUT', '/website/config', {
      ...config,
      routes: routes.map((m) => ({ ...m, distanceKm: '999' })),
    });
    assert.deepEqual(
      await h.call(owner, 'GET', `/website/itineraries/${plan.id}/quotation`),
      quote,
    );
    const copied = await h.call<WebsiteItinerary>(
      owner,
      'POST',
      `/website/itineraries/${plan.id}/copy`,
      { version: plan.version + 1 },
      201,
    );
    assert.deepEqual(
      copied.days[0].legs.map((leg) => [
        leg.vehicleType,
        leg.distanceKm,
        leg.durationMinutes,
        leg.showInMileage,
      ]),
      plan.days[0].legs.map((leg) => [
        leg.vehicleType,
        leg.distanceKm,
        leg.durationMinutes,
        leg.showInMileage,
      ]),
    );
    assert.deepEqual(copied.vehiclePrices, plan.vehiclePrices);
    await assert.rejects(h.db.undoLastMigration(), /before rollback/);
    console.log(
      `Website report: fresh/upgrade migrations, constraints, isolation, save/copy/freeze passed (${h.requests} API calls)`,
    );
  } finally {
    await h.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
