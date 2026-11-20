/** HTTP and migration verification on the independently created, disposable localhost database. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IsolationHarness } from './business-isolation.harness';
import { WEBSITE_PRICE_CATEGORIES } from '../src/website/website-price';
import type {
  WebsiteConfig,
  WebsiteDay,
  WebsiteInquiry,
  WebsiteItinerary,
  WebsitePreview,
  WebsiteQuotation,
} from '../src/website/website.types';

const h = new IsolationHarness();
const dates = ['2026-11-21', '2026-11-23', '2026-11-24', '2026-11-26'];

async function main() {
  try {
    await h.start();
    assert.deepEqual(await h.db.runMigrations(), []);
    const editor = await h.actor('website', 'RESOURCE_MANAGER');
    const owner = await h.actor('website');
    const linxi = await h.actor('linxi');
    const base = await h.call<WebsiteConfig>(editor, 'GET', '/website/config');
    const cities = ['昆明', '大理'].map((nameZh, index) => ({
      id: randomUUID(),
      status: 'enabled',
      resourceId: null,
      nameZh,
      nameEn: ['Kunming', 'Dali'][index],
    }));
    const config = await h.call<WebsiteConfig>(
      editor,
      'PUT',
      '/website/config',
      {
        ...base,
        cities,
        templates: [
          'optional-not-included',
          'peak-season',
          'hotel-substitution',
          'no-shopping',
        ].map((code) => ({
          id: randomUUID(),
          status: 'enabled',
          name: code,
          code,
          zh: '说明',
          en: 'Note',
        })),
      },
    );
    const [country] = await h.db.query<{ id: string }[]>(
      "SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' AND i.status='enabled' LIMIT 1",
    );
    const legacyInput = {
      countryItemId: country.id,
      customerName: 'Service date fixture',
      requirements: 'Trip',
      plannedDays: 1,
      startDate: dates[0],
    };
    const inquiries = '/website/inquiries';
    const detail = (id: string) =>
      h.call<WebsiteInquiry>(owner, 'GET', inquiries + '/' + id);
    const day = (city: string, dayNumber: number): WebsiteDay => ({
      id: randomUUID(),
      dayNumber,
      departCityId: city,
      endCityId: city,
      overnightCityId: null,
      guideLanguage: '',
      items: [],
      legs: [],
      meals: [],
      hotels: [],
      services: [],
    });
    const price = {
      hotelTier: null,
      vehicleType: null,
      unitPrice: '100.00',
      priceComponents: WEBSITE_PRICE_CATEGORIES.map((category) => ({
        category,
        unitPrice: category === 'vehicle' ? '100.00' : '0.00',
        showInPdf: false,
      })),
    };
    const planInput = {
      title: 'Calendar',
      duration: 1,
      startDate: dates[0],
      configVersion: config.version,
      pax: 2,
      vehiclePrices: [price],
    };
    const newPlan = (i: WebsiteInquiry, days: WebsiteDay[]) =>
      h.call<WebsiteItinerary>(
        owner,
        'POST',
        inquiries + '/' + i.id + '/itineraries',
        { ...planInput, days, inquiryVersion: i.version },
        201,
      );
    const planPath = (p: WebsiteItinerary) => '/website/itineraries/' + p.id;
    const confirm = async (p: WebsiteItinerary) =>
      h.call<WebsiteQuotation>(
        owner,
        'POST',
        planPath(p) + '/confirm',
        {
          version: p.version,
          inquiryVersion: (await detail(p.inquiryId)).version,
          acknowledgedWarnings: [],
        },
        201,
      );

    const old = await h.call<WebsiteInquiry>(
      owner,
      'POST',
      inquiries,
      legacyInput,
      201,
    );
    const oldPlan = await newPlan(old, [day(cities[0].id, 1)]);
    const oldQuote = await confirm(oldPlan);
    // Retain a real predecessor inquiry, its structured day and frozen quote through upgrade.
    await h.db.undoLastMigration();
    await h.db.query(
      'UPDATE website_inquiries SET planned_days=$2 WHERE id=$1',
      [old.id, 1],
    );
    assert.equal(
      (await h.db.runMigrations())[0].name,
      'AddWebsiteServiceDates1796256013000',
    );
    assert.deepEqual(await h.db.runMigrations(), []);
    assert.equal((await detail(old.id)).serviceDates, null);
    assert.deepEqual(
      await h.call(owner, 'GET', planPath(oldPlan) + '/quotation'),
      oldQuote,
    );
    assert.equal(
      (
        await h.db.query<{ duration: number }[]>(
          'SELECT duration FROM website_itineraries WHERE id=$1',
          [oldPlan.id],
        )
      )[0].duration,
      1,
    );

    for (const invalid of [
      [],
      [dates[0], dates[0]],
      ['2026-02-30'],
      ['2026-11-21T01:00:00Z'],
      Array(366).fill(dates[0]),
    ]) {
      await h.call(
        owner,
        'POST',
        inquiries,
        { ...legacyInput, serviceDates: invalid },
        400,
        'VALIDATION_ERROR',
      );
    }
    await h.call(
      linxi,
      'POST',
      inquiries,
      { ...legacyInput, serviceDates: dates },
      400,
      'VALIDATION_ERROR',
    );
    const inquiry = await h.call<WebsiteInquiry>(
      owner,
      'POST',
      inquiries,
      {
        ...legacyInput,
        plannedDays: undefined,
        startDate: null,
        serviceDates: [...dates].reverse(),
      },
      201,
    );
    assert.deepEqual(inquiry.serviceDates, dates);
    assert.equal(inquiry.startDate, dates[0]);
    assert.equal(inquiry.plannedDays, 4);
    const days = dates.map((_, i) => day(cities[i === 0 ? 0 : 1].id, i + 1));
    const plan = await newPlan(inquiry, days);
    assert.deepEqual(plan.serviceDates, dates);
    assert.equal(plan.duration, 4);
    const firstQuote = await confirm(plan);
    for (const out of [firstQuote.english, firstQuote.chinese])
      assert.deepEqual(
        out.itinerary.map((row) => row.day),
        dates,
      );
    assert.equal(firstQuote.validationVersion, 8);
    let copy = await h.call<WebsiteItinerary>(
      owner,
      'POST',
      planPath(plan) + '/copy',
      {
        version: (await h.call<WebsiteItinerary>(owner, 'GET', planPath(plan)))
          .version,
      },
      201,
    );
    assert.deepEqual(copy.serviceDates, dates);
    assert.notEqual(copy.days[0].id, plan.days[0].id);
    const originalDays = copy.days;
    const shortened = {
      ...planInput,
      version: copy.version,
      serviceDates: [dates[0], dates[1], dates[3]],
      days: [
        originalDays[0],
        originalDays[1],
        { ...originalDays[3], dayNumber: 3 },
      ],
    };
    await h.call(
      owner,
      'PUT',
      planPath(copy),
      shortened,
      400,
      'ITINERARY_INVALID',
    );
    const removed = await h.call<WebsiteItinerary>(
      owner,
      'PUT',
      planPath(copy),
      {
        ...shortened,
        deletedDays: [{ day: originalDays[2], originalDate: null }],
      },
    );
    assert.equal(removed.deletedDays?.[0].originalDate, dates[2]);
    copy = await h.call<WebsiteItinerary>(owner, 'PUT', planPath(copy), {
      ...planInput,
      version: removed.version,
      serviceDates: dates,
      days: originalDays,
      deletedDays: [],
    });
    const newDates = [dates[0], dates[1], '2026-11-25', dates[3]];
    const updateInquiry = async (serviceDates?: string[] | null) =>
      h.call<WebsiteInquiry>(owner, 'PUT', inquiries + '/' + inquiry.id, {
        ...legacyInput,
        serviceDates,
        version: (await detail(inquiry.id)).version,
      });
    await updateInquiry(newDates);
    assert.deepEqual((await updateInquiry()).serviceDates, newDates);
    assert.deepEqual(
      (await h.call<WebsiteItinerary>(owner, 'GET', planPath(copy)))
        .serviceDates,
      dates,
    );
    const preview = await h.call<WebsitePreview>(
      owner,
      'GET',
      planPath(copy) + '/preview',
    );
    assert(
      preview.issues.some((issue) => issue.code === 'REQUIREMENTS_MISMATCH'),
    );
    await h.call(
      owner,
      'POST',
      planPath(copy) + '/confirm',
      {
        version: copy.version,
        inquiryVersion: (await detail(inquiry.id)).version,
        acknowledgedWarnings: [],
      },
      400,
      'PDF_NOT_READY',
    );
    const changes = {
      ...planInput,
      version: copy.version,
      serviceDates: newDates,
      days: copy.days,
    };
    const badDays = copy.days.map((d, i) => ({
      ...d,
      dayNumber: i === 0 ? 2 : i === 1 ? 1 : i + 1,
    }));
    await h.call(
      owner,
      'PUT',
      planPath(copy),
      { ...changes, days: badDays },
      400,
      'ITINERARY_INVALID',
    );
    const revised = await h.call<WebsiteItinerary>(
      owner,
      'PUT',
      planPath(copy),
      changes,
    );
    const secondQuote = await confirm(revised);
    assert.deepEqual(
      secondQuote.english.itinerary.map((row) => row.day),
      newDates,
    );
    assert.deepEqual(
      await h.call(owner, 'GET', planPath(plan) + '/quotation'),
      firstQuote,
    );
    assert.equal((await updateInquiry(null)).serviceDates, null);
    await h.call(owner, 'POST', planPath(revised) + '/download-click');
    const tourInput = {
      scheduleMode: 'manual',
      pickupAt: dates[0] + ' 09:00',
      dropAt: dates[3] + ' 17:00',
      operatorId: owner.id,
      adults: 2,
      children: 0,
      leaders: 0,
      shopping: false,
      guideServices: [],
    };
    const tour = await h.call<{
      id: string;
      version: number;
      days: number;
      serviceDates: string[];
      dropAt: string;
    }>(
      owner,
      'POST',
      '/tours',
      {
        ...tourInput,
        sourceModule: 'website',
        inquiryId: inquiry.id,
        quoteId: secondQuote.id,
      },
      201,
    );
    assert.deepEqual(tour.serviceDates, newDates);
    assert.equal(tour.days, 4);
    assert.equal(tour.dropAt, tourInput.dropAt);
    await h.call(owner, 'PUT', '/tours/' + tour.id, {
      ...tourInput,
      version: tour.version,
      dropAt: dates[3] + ' 18:00',
    });
    console.log(
      'Verified fresh/repeated migrations, representative upgrade, isolation, exact dates, rescheduling, copy, bilingual freezes and linked tour time through ' +
        h.requests +
        ' HTTP calls.',
    );
  } finally {
    await h.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
