/** Disposable localhost databases only; all notification delivery is mocked. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { IsolationHarness, type Page } from './business-isolation.harness';
import { InquiryRemindersService } from '../src/inquiries/inquiry-reminders.service';
import type { FeishuService } from '../src/feishu/feishu.service';
import type { ItineraryInput } from '../src/inquiries/inquiry.dto';
import type { CurrentPdfData } from '../src/inquiries/inquiry.entity';
import type { TourGuideSearchResponse } from '../src/tours/tour.dto';
import { reminderDueAt } from '../src/inquiries/follow-ups';

const h = new IsolationHarness();
interface Inquiry {
  id: string;
  version: number;
  isSeries: boolean;
  plannedDays: number | null;
  ownerId: string;
}
interface Plan extends ItineraryInput {
  id: string;
  version: number;
  days: number;
  displayDays: number;
  accommodationNights: number;
}
interface Tour {
  id: string;
  version: number;
  startDate: string;
  isSeriesSource: boolean;
  guideServices: {
    id: string;
    conflictConfirmation: {
      confirmedBy: string;
      confirmedByName: string;
      token: string;
    } | null;
  }[];
}
interface Follow {
  id: string;
  legacy: boolean;
  followedAt: string | null;
  followedBy: string | null;
  reminderStatus: string;
  deliveryUnknown: boolean;
  recipientId: string | null;
}
const day = (
  id: string,
  date: string,
): ItineraryInput['dailyPlans'][number] => ({
  id,
  date,
  dayNumber: 1,
  departure: '昆明',
  destination: '昆明',
  viaDestinations: ['大理'],
  overnightDestination: '',
  transport: '',
  description: '观光',
  descriptionEn: 'Sightseeing',
  meals: { breakfast: false, lunch: false, dinner: false },
  items: [],
});
function draft(): ItineraryInput {
  return {
    title: '系列报价',
    titleEn: 'Series quotation',
    startDate: '2030-01-01',
    paxTiers: [20],
    childRate: 80,
    childWithoutBedRate: 60,
    destinations: ['昆明', '大理'],
    customerDisplayMode: 'returnArrival',
    returnArrivalText: '返回温馨的家',
    returnArrivalTextEn: 'Arrive home',
    dailyPlans: [day('day1', '2030-01-01'), day('day2', '2030-01-02')],
    hotelPlans: [],
    guidePlans: [],
    vehiclePlans: [
      {
        tier: 'standard',
        quotationMode: 'stage',
        totalPrice: null,
        paxPrices: [{ pax: 20, totalPrice: 0, pricingMode: 'automatic' }],
        arrangements: [
          {
            id: 'range1',
            startDate: '2030-01-01',
            endDate: '2030-01-02',
            vehicles: [],
            paxPrices: [{ pax: 20, totalPrice: 0 }],
          },
        ],
      },
    ],
    quote: {
      mealOtherCost: null,
      mealOtherReason: '',
      attractionOtherCost: null,
      attractionOtherReason: '',
      paxOtherCosts: [],
      staffRoomCosts: [],
      options: [],
      transportFees: [],
      chineseTip: null,
      englishTip: null,
      customerNotes: '',
      holidayRestrictions: '',
      hotelReplacementTerms: '',
    },
  };
}

async function upgrade() {
  const connection = {
    type: 'postgres' as const,
    host: '127.0.0.1',
    port: Number(process.env.ISOLATION_PG_PORT ?? 55461),
    username: 'postgres',
    password: 'isolation-ci-only',
  };
  const name = `inquiry_upgrade_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const admin = await new DataSource({
    ...connection,
    database: 'postgres',
  }).initialize();
  const db = new DataSource({
    ...connection,
    database: name,
    entities: ['src/**/*.entity.ts'],
    migrations: ['src/migrations/*.ts'],
    synchronize: false,
  });
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    await db.initialize();
    const added = db.migrations.filter((m) => m.name?.includes('179608320'));
    assert.equal(added.length, 4);
    db.migrations.splice(
      0,
      db.migrations.length,
      ...db.migrations.filter((m) => !added.includes(m)),
    );
    await db.runMigrations();
    const [u] = await db.query<{ id: string }[]>(
      `INSERT INTO users(username,password_hash,nickname,english_name,tour_code) VALUES('old','fixture','Old','Old','OLD') RETURNING id`,
    );
    const [i] = await db.query<{ id: string }[]>(
      `INSERT INTO inquiries(code,owner_id,owner,status,creator,business_unit,agency_id,contact_id,agency_code,agency_name,contact_name,email,phone,country_or_region,source_channel,original_message,internal_remark,planned_days,next_follow_up_at,lost_reason)
      VALUES('INQ-OLD',$1,'Old','new','old','shengxu',$2,$3,'A','Agency','Contact','','','China','old','request','historical note',1,'2030-01-01T08:00:00.000Z','') RETURNING id`,
      [u.id, randomUUID(), randomUUID()],
    );
    const before = await db.query<Record<string, unknown>[]>(
      'SELECT * FROM inquiries WHERE id=$1',
      [i.id],
    );
    db.migrations.push(...added);
    assert.equal((await db.runMigrations()).length, 4);
    assert.equal((await db.runMigrations()).length, 0);
    const [after] = await db.query<Record<string, unknown>[]>(
      'SELECT * FROM inquiries WHERE id=$1',
      [i.id],
    );
    const { is_series, ...preserved } = after;
    assert.equal(is_series, false);
    assert.deepEqual(preserved, before[0]);
    const [history] = await db.query<
      {
        remark: string;
        legacy: boolean;
        followed_at: null;
        followed_by: null;
      }[]
    >('SELECT * FROM inquiry_follow_ups WHERE inquiry_id=$1', [i.id]);
    assert.equal(history.remark, 'historical note');
    assert(history.legacy);
    assert.equal(history.followed_at, null);
    assert.equal(history.followed_by, null);
    assert.equal(
      (await db.query<unknown[]>('SELECT 1 FROM inquiry_follow_up_reminders'))
        .length,
      0,
    );
    console.log(
      'PASS old-data upgrade, preservation, legacy history without invented audit, repeat migrations',
    );
  } finally {
    if (db.isInitialized) await db.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.destroy();
  }
}

async function main() {
  await upgrade();
  try {
    await h.start();
    await h.get(InquiryRemindersService).onModuleDestroy();
    const owner = await h.actor('shengxu');
    const other = await h.actor('shengxu');
    const manager = await h.actor('shengxu', 'BUSINESS_MANAGER');
    const foreign = await h.actor('linxi');
    const [country] = await h.db.query<{ id: string }[]>(
      `INSERT INTO system_business_dictionary_items(type_id,name,english_name,code) SELECT id,'测试国家','Test country','CRTEST' FROM system_business_dictionary_types WHERE code='country-region' RETURNING id`,
    );
    await h.db.query(
      `UPDATE resource_cities SET english_name=CASE name WHEN '昆明' THEN 'Kunming' WHEN '大理' THEN 'Dali' ELSE name END`,
    );
    let inquiry = await h.call<Inquiry>(
      owner,
      'POST',
      '/inquiries',
      { isSeries: true, countryItemId: country.id },
      201,
    );
    assert(inquiry.isSeries);
    assert.equal(inquiry.plannedDays, null);
    assert.equal(inquiry.ownerId, owner.id);
    await h.call(
      owner,
      'POST',
      `/inquiries/${inquiry.id}/follow-ups`,
      {
        version: inquiry.version,
        requestId: randomUUID(),
        remark: 'invalid date',
        nextFollowUpAt: '2035-01-01',
        reminderDays: 1,
      },
      400,
      'VALIDATION_ERROR',
    );
    await h.call(
      manager,
      'POST',
      '/inquiries',
      { isSeries: true, countryItemId: country.id },
      400,
      'INQUIRY_OWNER_INVALID',
    );
    await h.call(
      foreign,
      'POST',
      '/inquiries',
      { isSeries: true, countryItemId: country.id },
      400,
      'ITINERARY_INVALID',
    );
    await h.call(
      other,
      'GET',
      `/inquiries/${inquiry.id}`,
      undefined,
      404,
      'INQUIRY_NOT_FOUND',
    );
    let plan = await h.call<Plan>(
      owner,
      'POST',
      `/inquiries/${inquiry.id}/itineraries`,
      draft(),
      201,
    );
    assert.equal(plan.dailyPlans.length, 2);
    assert.equal(plan.displayDays, 3);
    assert.equal(plan.accommodationNights, 0);
    assert.equal(plan.quote.options[0].hotelTier, null);
    let pdf = await h.call<CurrentPdfData>(
      owner,
      'GET',
      `/itineraries/${plan.id}/pdf-data?language=en`,
    );
    assert.deepEqual(pdf.customerPresentation?.en.days[0].route, [
      'Kunming',
      'Dali',
      'Kunming',
    ]);
    assert.equal(
      pdf.customerPresentation?.en.returnArrival?.date,
      '2030-01-03',
    );
    assert('pricingVersion' in pdf.calculation);
    assert.equal(pdf.calculation.options[0].hotelUnitCost, '0.00');
    assert.equal(
      pdf.calculation.options[0].paxPrices[0].singleSupplementUnitCost,
      '0.00',
    );
    const bad = draft();
    bad.dailyPlans[0].viaDestinations = ['未选城市'];
    await h.call(
      owner,
      'PUT',
      `/itineraries/${plan.id}`,
      { ...bad, version: plan.version },
      400,
      'ITINERARY_INVALID',
    );
    const pending = draft();
    pending.dailyPlans[0].overnightDestination = null;
    const pendingPlan = await h.call<Plan>(
      owner,
      'POST',
      `/inquiries/${inquiry.id}/itineraries`,
      pending,
      201,
    );
    await h.call(
      owner,
      'GET',
      `/itineraries/${pendingPlan.id}/pdf-data`,
      undefined,
      400,
      'PDF_NOT_READY',
    );
    const missing = draft();
    missing.titleEn = '';
    const missingPlan = await h.call<Plan>(
      owner,
      'POST',
      `/inquiries/${inquiry.id}/itineraries`,
      missing,
      201,
    );
    await h.call(
      owner,
      'GET',
      `/itineraries/${missingPlan.id}/pdf-data?language=en`,
      undefined,
      400,
      'PDF_NOT_READY',
    );
    await h.call(owner, 'GET', `/itineraries/${missingPlan.id}/pdf-data`);
    inquiry = await h.call<Inquiry>(owner, 'GET', `/inquiries/${inquiry.id}`);
    pdf = await h.call<CurrentPdfData>(
      owner,
      'POST',
      `/itineraries/${plan.id}/confirm-pdf`,
      {
        version: plan.version,
        inquiryVersion: inquiry.version,
        language: 'en',
      },
      201,
    );
    await h.db.query(
      `UPDATE resource_cities SET english_name='Changed' WHERE name='大理'`,
    );
    const frozen = await h.call<CurrentPdfData>(
      owner,
      'GET',
      `/itineraries/${plan.id}/pdf-data?language=en`,
    );
    assert.deepEqual(frozen, pdf);
    plan = await h.call<Plan>(owner, 'GET', `/itineraries/${plan.id}`);
    const copy = await h.call<Plan>(
      owner,
      'POST',
      `/itineraries/${plan.id}/copy`,
      { version: plan.version, title: '复制' },
      201,
    );
    assert.deepEqual(copy.dailyPlans[0].viaDestinations, ['大理']);
    assert.equal(copy.customerDisplayMode, 'returnArrival');
    await h.call(owner, 'POST', `/itineraries/${plan.id}/download-click`);
    console.log(
      'PASS no-accommodation, unknown lodging rejection, ordered via cities, English completeness/freeze, customer-only return day and copy',
    );

    // Flights remain minute based; each series tour owns a different departure date.
    const airports = await h.db.query<{ id: string }[]>(
      `INSERT INTO system_business_dictionary_items(type_id,name,english_name,code) SELECT t.id,x.name,x.name,x.code FROM system_business_dictionary_types t CROSS JOIN (VALUES('Airport A','CRA'),('Airport B','CRB')) x(name,code) WHERE t.code='city-airport' RETURNING id`,
    );
    const [flight] = await h.db.query<{ id: string }[]>(
      `INSERT INTO resource_flights(departure_city,arrival_city,departure_airport_id,arrival_airport_id,flight_number,departure_time,arrival_time) VALUES('A','B',$1,$2,'CR001','12:10','15:35') RETURNING id`,
      [airports[0].id, airports[1].id],
    );
    const [quote] = await h.db.query<{ id: string }[]>(
      'SELECT id FROM itinerary_quotes WHERE itinerary_id=$1',
      [plan.id],
    );
    const tourBody = {
      sourceModule: 'standard',
      inquiryId: inquiry.id,
      quoteId: quote.id,
      seriesStartDate: '2030-02-01',
      operatorId: owner.id,
      adults: 20,
      children: 0,
      leaders: 0,
      language: '',
      shopping: false,
      pickupFlightId: flight.id,
      dropFlightId: flight.id,
      guideServices: [],
      remark: '',
    };
    inquiry = await h.call<Inquiry>(owner, 'GET', `/inquiries/${inquiry.id}`);
    const newFollow = async (days: number | null = 3) => {
      inquiry = await h.call<Inquiry>(owner, 'GET', `/inquiries/${inquiry.id}`);
      const payload = {
        version: inquiry.version,
        requestId: randomUUID(),
        remark: '跟进记录',
        nextFollowUpAt: '2035-01-01T10:00:00+08:00',
        reminderDays: days,
      };
      const result = await h.call<{
        id: string;
        inquiryVersion: number;
        delivery: { available: boolean };
      }>(owner, 'POST', `/inquiries/${inquiry.id}/follow-ups`, payload, 201);
      assert(!result.delivery.available);
      const repeat = await h.call<typeof result>(
        owner,
        'POST',
        `/inquiries/${inquiry.id}/follow-ups`,
        payload,
        201,
      );
      assert.equal(repeat.id, result.id);
      return result.id;
    };
    const firstFollow = await newFollow();
    const t1 = await h.call<Tour>(owner, 'POST', '/tours', tourBody, 201);
    assert(t1.isSeriesSource);
    const afterTour = await h.call<Page<Follow>>(
      owner,
      'GET',
      `/inquiries/${inquiry.id}/follow-ups`,
    );
    assert.equal(
      afterTour.list.find((f) => f.id === firstFollow)?.reminderStatus,
      'cancelled',
    );
    const t2 = await h.call<Tour>(
      owner,
      'POST',
      '/tours',
      { ...tourBody, seriesStartDate: '2030-03-01' },
      201,
    );
    assert.notEqual(t1.id, t2.id);
    assert.equal(t2.startDate, '2030-03-01');
    const sources = await h.call<{ inquiryId: string }[]>(
      owner,
      'GET',
      '/tours/sources?sourceModule=standard',
    );
    assert(sources.some((s) => s.inquiryId === inquiry.id));
    await h.call(
      owner,
      'POST',
      `/inquiries/${inquiry.id}/itineraries`,
      draft(),
      201,
    );
    const latest = await newFollow();
    const rows = await h.call<Page<Follow>>(
      owner,
      'GET',
      `/inquiries/${inquiry.id}/follow-ups`,
    );
    assert(rows.list.every((f) => f.followedBy === owner.id && f.followedAt));
    assert.equal(
      rows.list.find((f) => f.id === latest)?.reminderStatus,
      'pending',
    );
    await h.call(
      other,
      'GET',
      `/inquiries/${inquiry.id}/follow-ups`,
      undefined,
      404,
      'INQUIRY_NOT_FOUND',
    );
    assert.equal(
      reminderDueAt('2035-01-01T10:00:00+08:00', 3)?.toISOString(),
      '2034-12-29T02:00:00.000Z',
    );
    assert.throws(() => reminderDueAt('2020-01-01T10:00:00+08:00', 1));
    // Change ownership before delivery, then drain twice with a mock provider.
    await h.db.query(
      `UPDATE users SET feishu_open_id='ou_0123456789abcdef0123456789abcdef' WHERE id=$1`,
      [other.id],
    );
    inquiry = await h.call<Inquiry>(owner, 'GET', `/inquiries/${inquiry.id}`);
    await h.call(
      manager,
      'POST',
      `/inquiries/${inquiry.id}/transfer`,
      { version: inquiry.version, ownerId: other.id, reason: 'handoff' },
      201,
    );
    const sent: string[] = [];
    const worker = new InquiryRemindersService(h.db, {
      configured: true,
      sendText: (openId: string) => {
        sent.push(openId);
        return Promise.resolve({ messageId: 'mock-message' });
      },
    } as unknown as FeishuService);
    await h.db.query(
      `UPDATE inquiry_follow_up_reminders SET due_at=now()-interval '1 second' WHERE follow_up_id=$1`,
      [latest],
    );
    await worker.drain();
    await worker.drain();
    assert.deepEqual(sent, ['ou_0123456789abcdef0123456789abcdef']);
    const sentHistory = await h.call<Page<Follow>>(
      other,
      'GET',
      `/inquiries/${inquiry.id}/follow-ups`,
    );
    assert.equal(
      sentHistory.list.find((f) => f.id === latest)?.recipientId,
      other.id,
    );
    assert.equal(
      sentHistory.list.find((f) => f.id === latest)?.reminderStatus,
      'sent',
    );
    console.log(
      'PASS series repeated tours, continued planning/follow-up, immutable history, request deduplication, cancellation, owner handoff and single mocked delivery',
    );

    const [guide] = await h.db.query<{ id: string }[]>(
      `INSERT INTO resource_guide_people(code,name,language) VALUES('GPR-CR','Test Guide','English') RETURNING id`,
    );
    const service = {
      guideId: guide.id,
      language: 'English',
      serviceStartDate: '2030-04-01',
      serviceEndDate: '2030-04-01',
      remark: '',
    };
    const search = {
      businessUnit: 'shengxu',
      language: 'English',
      serviceStartDate: service.serviceStartDate,
      serviceEndDate: service.serviceEndDate,
      page: 1,
      pageSize: 1,
    };
    let available = await h.call<TourGuideSearchResponse>(
      other,
      'POST',
      '/tours/available-guides',
      search,
    );
    assert(available.list.some((g) => g.id === guide.id));
    const allocated = await h.call<Tour>(
      other,
      'POST',
      '/tours',
      {
        ...tourBody,
        seriesStartDate: '2030-04-01',
        operatorId: other.id,
        guideServices: [service],
      },
      201,
    );
    available = await h.call<TourGuideSearchResponse>(
      other,
      'POST',
      '/tours/available-guides',
      { ...search, keyword: 'Test Guide' },
    );
    const blocked = available.unavailable.find((g) => g.id === guide.id)!;
    assert(blocked.canOverride);
    assert(blocked.scheduleConflictToken);
    await h.call(
      other,
      'POST',
      '/tours',
      {
        ...tourBody,
        seriesStartDate: '2030-04-01',
        operatorId: other.id,
        guideServices: [service],
      },
      409,
      'CONFLICT',
    );
    const forced = await h.call<Tour>(
      other,
      'POST',
      '/tours',
      {
        ...tourBody,
        seriesStartDate: '2030-04-01',
        operatorId: other.id,
        guideServices: [
          { ...service, scheduleConflictToken: blocked.scheduleConflictToken },
        ],
      },
      201,
    );
    assert.equal(
      forced.guideServices[0].conflictConfirmation?.confirmedBy,
      other.id,
    );
    assert(forced.guideServices[0].conflictConfirmation?.confirmedByName);
    await h.call(
      other,
      'POST',
      '/tours',
      {
        ...tourBody,
        seriesStartDate: '2030-04-01',
        operatorId: other.id,
        guideServices: [
          { ...service, scheduleConflictToken: blocked.scheduleConflictToken },
        ],
      },
      409,
      'CONFLICT',
    );
    const next = await h.call<TourGuideSearchResponse>(
      other,
      'POST',
      '/tours/available-guides',
      {
        ...search,
        serviceStartDate: '2030-04-02',
        serviceEndDate: '2030-04-02',
      },
    );
    assert(next.list.some((g) => g.id === guide.id));
    await h.db.query(
      `UPDATE resource_guide_people SET language='French' WHERE id=$1`,
      [guide.id],
    );
    const mismatch = await h.call<TourGuideSearchResponse>(
      other,
      'POST',
      '/tours/available-guides',
      { ...search, keyword: 'Test Guide' },
    );
    assert.equal(mismatch.unavailable[0].canOverride, false);
    assert(!mismatch.unavailable[0].scheduleConflictToken);
    assert(allocated.id);
    console.log(
      'PASS day-only availability, optional name/pagination, explicit overlap override, changed-set reconfirmation, adjacent dates and non-overrideable language',
    );
    console.log(JSON.stringify({ requests: h.requests, result: 'passed' }));
  } finally {
    await h.close();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
