/** Uses only the disposable localhost database created/dropped by IsolationHarness. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  IsolationHarness,
  Actor,
  Page,
  RecordRef,
} from './business-isolation.harness';
import { GeneralizeCountryAirportDictionaries1795219200000 } from '../src/migrations/1795219200000-GeneralizeCountryAirportDictionaries';

const h = new IsolationHarness();
type Item = {
  id: string;
  code: string;
  name: string;
  englishName: string;
  status: string;
};
type Inquiry = RecordRef & { countryCode: string; countryItemId: string };
type Tour = RecordRef & {
  tourNo: string;
  countryCode: string;
  countryName: string;
};

async function run() {
  await h.start();
  assert.equal((await h.db.runMigrations()).length, 0);
  const root = await h.actor('headquarters', 'ROOT');
  const owner = await h.actor('shengxu');
  const website = await h.actor('website');
  const base = '/system/business-dictionaries';
  const createItem = (type: string, code: string, name: string) =>
    h.call<Item>(
      root,
      'POST',
      `${base}/${type}/items`,
      {
        code,
        name,
        englishName: `Custom ${name}`,
        status: 'enabled',
      },
      201,
    );
  const legacy = await createItem('country-region', 'CHN', '旧国家');
  const legacyAirport = await createItem('city-airport', 'PEK', '旧机场');
  const createAgency = (countryItemId: string) =>
    h.call(
      root,
      'POST',
      '/resources/agencies',
      {
        email: '',
        remark: '',
        name: `测试社${countryItemId}`,
        countryItemId,
        city: '测试市',
        businessUnit: 'shengxu',
        coordinatorId: owner.id,
        status: 'enabled',
      },
      201,
    );
  const legacyAgency = await createAgency(legacy.id);
  const contact = await h.call(
    owner,
    'POST',
    `/inquiries/contacts/${legacyAgency.id}`,
    { name: '联系人', phone: '' },
    201,
  );
  const standardInput = (countryItemId: string) => ({
    agencyId: legacyAgency.id,
    contactId: contact.id,
    countryItemId,
    sourceChannel: 'test',
    originalMessage: 'test',
    plannedDays: 1,
  });
  const websiteInput = (countryItemId: string) => ({
    customerName: '测试客户',
    countryItemId,
    plannedDays: 1,
    requirements: 'test',
  });
  const manual = (actor: Actor, countryItemId: string) => ({
    sourceModule: 'manual',
    scheduleMode: 'manual',
    operatorId: actor.id,
    adults: 1,
    children: 0,
    leaders: 0,
    shopping: false,
    guideServices: [],
    pickupAt: '2030-01-01 09:00',
    dropAt: '2030-01-02 09:00',
    manualSource: {
      businessUnit: actor.scope,
      countryItemId,
      collectCoordinatorId: actor.id,
      ...(actor.scope === 'shengxu' ? { agencyId: legacyAgency.id } : {}),
      itinerarySummary: '测试行程',
      startDate: '2030-01-01',
      days: 1,
    },
  });

  // Simulate the exact preceding column widths with representative live/frozen rows.
  await h.db
    .query(`ALTER TABLE inquiries ALTER COLUMN country_code TYPE varchar(7);
    ALTER TABLE website_inquiries ALTER COLUMN country_code TYPE varchar(7);
    ALTER TABLE tours ALTER COLUMN country_code TYPE varchar(7), ALTER COLUMN tour_no TYPE varchar(80)`);
  const oldInquiry = await h.call<Inquiry>(
    owner,
    'POST',
    '/inquiries',
    standardInput(legacy.id),
    201,
  );
  await h.call(
    website,
    'POST',
    '/website/inquiries',
    websiteInput(legacy.id),
    201,
  );
  await h.call<Tour>(root, 'POST', '/tours', manual(owner, legacy.id), 201);
  const oldPlanId = randomUUID();
  await h.db.query(
    `INSERT INTO itineraries(id,inquiry_id,code,creator,title,start_date,pax_tiers,status)
    VALUES($1,$2,$3,'Fixture','Old','2030-01-01','{10}','quoted')`,
    [oldPlanId, oldInquiry.id, `IT-${oldPlanId}`],
  );
  await h.db.query(
    `INSERT INTO itinerary_quotes(itinerary_id,source_version,created_by,snapshot,quote_code,quote_version,inquiry_id,inquiry_version,daily_resource_cost,guide_cost)
    VALUES($1,1,$2,'{"unchanged":"历史冻结"}', $3,1,$4,1,0,0)`,
    [oldPlanId, owner.id, `QT-${oldPlanId}`, oldInquiry.id],
  );
  const snapshot = async () => {
    const rows: unknown[] = [];
    for (const table of [
      'system_business_dictionary_types',
      'system_business_dictionary_items',
      'resource_agencies',
      'inquiries',
      'website_inquiries',
      'tours',
      'itinerary_quotes',
    ])
      rows.push(await h.db.query(`SELECT * FROM ${table} ORDER BY id`));
    return rows;
  };
  const before = await snapshot();
  const runner = h.db.createQueryRunner();
  try {
    await new GeneralizeCountryAirportDictionaries1795219200000().up(runner);
  } finally {
    await runner.release();
  }
  assert.deepEqual(await snapshot(), before);
  console.log(
    'PASS full migration chain, repeat execution and old-width upgrade preserve rows, IDs, references and frozen snapshots',
  );

  const country = await createItem(
    'country-region',
    `Region-${'X'.repeat(93)}`,
    '自定义国家',
  );
  assert.equal(country.code.length, 100);
  const airport = await createItem(
    'city-airport',
    'Airport-New-123',
    '自定义机场',
  );
  const ordinary = await h.call<{ id: string }>(
    root,
    'POST',
    base,
    { code: 'custom-test', name: '测试分类', englishName: 'Test' },
    201,
  );
  assert(ordinary.id);
  await createItem('custom-test', 'Uppercase-123', '普通选项');
  for (const type of ['country-region', 'city-airport']) {
    const item = type === 'country-region' ? country : airport;
    const list = await h.call<Item[]>(
      root,
      'GET',
      `${base}/${type}/items?keyword=${item.code}&status=enabled`,
    );
    assert.deepEqual(
      list.map((row) => row.id),
      [item.id],
    );
    await h.call(
      root,
      'POST',
      `${base}/${type}/items`,
      itemBody(item),
      409,
      'BUSINESS_DICTIONARY_ITEM_CODE_EXISTS',
    );
    await h.call(
      root,
      'POST',
      `${base}/${type}/items`,
      { ...itemBody(item), code: '1bad' },
      400,
      'VALIDATION_ERROR',
    );
    const renamed = await h.call<Item>(
      root,
      'PUT',
      `${base}/${type}/items/${item.id}`,
      { ...itemBody(item), englishName: `${item.englishName} edited` },
    );
    Object.assign(item, renamed);
  }
  const agency = await createAgency(country.id);
  assert(agency.id);
  const inquiry = await h.call<Inquiry>(
    owner,
    'POST',
    '/inquiries',
    standardInput(country.id),
    201,
  );
  const webInquiry = await h.call<Inquiry>(
    website,
    'POST',
    '/website/inquiries',
    websiteInput(country.id),
    201,
  );
  assert.equal(inquiry.countryCode, country.code);
  assert.equal(webInquiry.countryCode, country.code);
  const flightInput = {
    departureAirportId: airport.id,
    arrivalAirportId: legacyAirport.id,
    flightNumber: 'CUSTOM123',
    departureTime: '08:00',
    arrivalTime: '10:00',
    status: 'enabled',
  };
  const flight = await h.call<RecordRef & { departureAirport: Item }>(
    root,
    'POST',
    '/resources/flights',
    flightInput,
    201,
  );
  assert.equal(flight.departureAirport.code, airport.code);
  const flights = await h.call<Page>(
    root,
    'GET',
    `/resources/flights?keyword=${airport.code}`,
  );
  assert.deepEqual(
    flights.list.map((row) => row.id),
    [flight.id],
  );
  const choices = await h.call<Page>(
    owner,
    'GET',
    `/tours/flights?keyword=${airport.code}`,
  );
  assert.deepEqual(
    choices.list.map((row) => row.id),
    [flight.id],
  );
  const manualTour = await h.call<Tour>(
    root,
    'POST',
    '/tours',
    manual(owner, country.id),
    201,
  );
  assert.equal(manualTour.countryCode, country.code);
  assert(manualTour.tourNo.endsWith(`-${country.code}`));
  assert(manualTour.tourNo.length > 80);
  console.log(
    'PASS custom country/airport CRUD, generic uppercase codes, uniqueness, search, agencies, both inquiry modules, flights and manual tours',
  );

  // Minimal frozen fixtures isolate linked-tour consumption from quote calculation.
  for (const [actor, source, sourceInquiry] of [
    [owner, 'standard', inquiry],
    [website, 'website', webInquiry],
  ] as const) {
    const planId = randomUUID(),
      quoteId = randomUUID();
    const frozen = {
      itinerary: { code: `IT-${planId}`, startDate: '2030-01-01', days: 1 },
      unchanged: '自定义国家冻结',
    };
    if (source === 'standard') {
      await h.db.query(
        `INSERT INTO itineraries(id,inquiry_id,code,creator,title,start_date,pax_tiers,status)
        VALUES($1,$2,$3,'Fixture','Test','2030-01-01','{10}','quoted')`,
        [planId, sourceInquiry.id, `IT-${planId}`],
      );
      await h.db.query(
        `INSERT INTO itinerary_quotes(id,itinerary_id,source_version,created_by,snapshot,quote_code,quote_version,inquiry_id,inquiry_version,daily_resource_cost,guide_cost,first_downloaded_at)
        VALUES($1,$2,1,$3,$4::jsonb,$5,1,$6,1,0,0,now())`,
        [
          quoteId,
          planId,
          actor.id,
          JSON.stringify(frozen),
          `QT-${quoteId}`,
          sourceInquiry.id,
        ],
      );
    } else {
      await h.db.query(
        `INSERT INTO website_itineraries(id,inquiry_id,code,title,duration,start_date,config_version,status,business_unit)
        VALUES($1,$2,$3,'Test',1,'2030-01-01',(SELECT version FROM website_config_current WHERE business_unit='website'),'quoted','website')`,
        [planId, sourceInquiry.id, `IT-${planId}`],
      );
      await h.db.query(
        `INSERT INTO website_quotations(id,itinerary_id,code,snapshot,confirmed_by,first_downloaded_at)
        VALUES($1,$2,$3,$4::jsonb,$5,now())`,
        [quoteId, planId, `QT-${quoteId}`, JSON.stringify(frozen), actor.id],
      );
    }
    const tour = await h.call<Tour>(
      root,
      'POST',
      '/tours',
      {
        sourceModule: source,
        inquiryId: sourceInquiry.id,
        quoteId,
        operatorId: actor.id,
        adults: 1,
        children: 0,
        leaders: 0,
        shopping: false,
        guideServices: [],
        scheduleMode: 'flight',
        pickupFlightId: flight.id,
        dropFlightId: flight.id,
      },
      201,
    );
    assert.equal(tour.countryCode, country.code);
    assert(tour.tourNo.endsWith(`-${country.code}`));
    const [stored] = await h.db.query<{ snapshot: unknown }[]>(
      `SELECT snapshot FROM ${source === 'standard' ? 'itinerary_quotes' : 'website_quotations'} WHERE id=$1`,
      [quoteId],
    );
    assert.deepEqual(stored.snapshot, frozen);
  }
  console.log(
    'PASS standard and website linked tours accept custom country snapshots and retain full country suffixes',
  );

  for (const [type, item] of [
    ['country-region', country],
    ['city-airport', airport],
  ] as const) {
    await h.call(
      root,
      'PUT',
      `${base}/${type}/items/${item.id}`,
      { ...itemBody(item), code: `${item.code.slice(0, 90)}-changed` },
      409,
      'CONFLICT',
    );
    await h.call(
      root,
      'PUT',
      `${base}/${type}/items/${item.id}`,
      { ...itemBody(item), englishName: 'Changed after reference' },
      409,
      'CONFLICT',
    );
    await h.call(
      root,
      'DELETE',
      `${base}/${type}/items?ids=${item.id}`,
      undefined,
      409,
      'CONFLICT',
    );
    await h.call(root, 'PUT', `${base}/${type}/items/${item.id}`, {
      ...itemBody(item),
      name: '当前显示名称',
      status: 'disabled',
    });
  }
  await h.call(
    owner,
    'POST',
    '/inquiries',
    standardInput(country.id),
    400,
    'VALIDATION_ERROR',
  );
  await h.call(
    website,
    'POST',
    '/website/inquiries',
    websiteInput(country.id),
    400,
    'VALIDATION_ERROR',
  );
  await h.call(
    root,
    'POST',
    '/resources/flights',
    { ...flightInput, flightNumber: 'DISABLED1' },
    400,
    'VALIDATION_ERROR',
  );
  await h.call(
    owner,
    'POST',
    '/inquiries',
    standardInput(airport.id),
    400,
    'VALIDATION_ERROR',
  );
  assert.equal(
    (await h.call<Inquiry>(owner, 'GET', `/inquiries/${inquiry.id}`))
      .countryCode,
    country.code,
  );
  assert.equal(
    (await h.call<Tour>(owner, 'GET', `/tours/${manualTour.id}`)).countryName,
    country.name,
  );
  assert.equal(
    (
      await h.call<RecordRef & { departureAirport: Item }>(
        root,
        'GET',
        `/resources/flights/${flight.id}`,
      )
    ).departureAirport.code,
    airport.code,
  );
  console.log(
    `PASS reference protections, disabled/wrong-category rejection and historical reads; ${h.requests} HTTP requests`,
  );
}

function itemBody(item: Item) {
  return {
    code: item.code,
    name: item.name,
    englishName: item.englishName,
    status: item.status,
  };
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => h.close());
