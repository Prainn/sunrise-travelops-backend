import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IsolationHarness } from './business-isolation.harness';
import type {
  WebsiteConfig,
  WebsiteDay,
  WebsiteInquiry,
  WebsiteItinerary,
} from '../src/website/website.types';

async function main() {
  const h = new IsolationHarness();
  try {
    await h.start();
    const owner = await h.actor('website');
    const config = await h.call<WebsiteConfig>(owner, 'GET', '/website/config');
    const [country] = await h.db.query<{ id: string }[]>(
      "SELECT i.id FROM system_business_dictionary_items i JOIN system_business_dictionary_types t ON t.id=i.type_id WHERE t.code='country-region' AND i.status='enabled' LIMIT 1",
    );
    const dates = ['2026-11-19', '2026-11-21', '2026-11-24'];
    const inquiry = await h.call<WebsiteInquiry>(
      owner,
      'POST',
      '/website/inquiries',
      {
        countryItemId: country.id,
        customerName: 'Fixture',
        requirements: 'Trip',
        serviceDates: dates,
      },
      201,
    );
    const city = config.cities[0]?.id ?? randomUUID();
    const days: WebsiteDay[] = dates.map((_, index) => ({
      id: randomUUID(),
      dayNumber: index + 1,
      departCityId: city,
      endCityId: city,
      overnightCityId: null,
      guideLanguage: '',
      items: [],
      legs: [],
      hotels: [],
      meals: [],
      services: [],
      eventOrder: [],
    }));
    const selected = days[2];
    selected.overnightCityId = city;
    selected.guideLanguage = 'English';
    selected.items = Array.from({ length: 16 }, (_, i) => ({
      id: randomUUID(),
      attractionId: null,
      nameZh: '景点' + i,
      nameEn: 'Stop ' + i,
      descriptionZh: '',
      descriptionEn: '',
      appears: true,
      feeState: 'INCLUDED',
    }));
    const meal = {
      id: randomUUID(),
      slot: 'breakfast' as const,
      resourceId: null,
      restaurantZh: '早餐',
      restaurantEn: 'Breakfast',
      feeState: 'INCLUDED' as const,
    };
    selected.meals = [meal];
    days[0].meals = [{ ...meal, id: randomUUID() }];
    const leg = {
      id: randomUUID(),
      routeId: null,
      fromCityId: city,
      toCityId: city,
      mode: 'other' as const,
      nameZh: '交通',
      nameEn: 'Transfer',
      feeState: 'INCLUDED' as const,
      isAirportDropoff: true,
    };
    const removedLeg = { ...leg, id: randomUUID(), isAirportDropoff: false };
    selected.legs = [leg, removedLeg];
    const hotel = {
      id: randomUUID(),
      cityId: city,
      resourceId: null,
      configHotelId: null,
      tier: 'A' as const,
      nameZh: '酒店',
      nameEn: 'Hotel',
      roomType: '',
      breakfastIncluded: true,
    };
    const secondHotel = {
      ...hotel,
      id: randomUUID(),
      nightlyOnly: true,
      nightlySelected: true,
      nightlyRooms: 2,
      nightlyRate: '310.00',
    };
    selected.hotels = [hotel, secondHotel];
    const stops = selected.items.map((item) => item.id);
    const guide = selected.id + '-guide';
    selected.eventOrder = [
      guide,
      stops[0],
      hotel.id,
      leg.id,
      meal.id,
      ...stops.slice(1),
      removedLeg.id,
      secondHotel.id,
    ];
    const input = {
      title: '查看当天',
      duration: 3,
      configVersion: config.version,
      serviceDates: dates,
      hotelPricingMode: 'nightly',
      nightlyShowHotelPrice: false,
      nightlyVehiclePrices: [],
      vehiclePrices: [],
    };
    const created = await h.call<WebsiteItinerary>(
      owner,
      'POST',
      '/website/inquiries/' + inquiry.id + '/itineraries',
      { ...input, days, inquiryVersion: inquiry.version },
      201,
    );
    const path = '/website/itineraries/' + created.id;
    const original = await h.call<WebsiteItinerary>(owner, 'GET', path);
    const edited = structuredClone(original.days);
    const target = edited.find((day) => day.id === selected.id)!;
    target.meals = [
      {
        ...meal,
        id: randomUUID(),
        slot: 'lunch',
        restaurantZh: '午餐',
        restaurantEn: 'Lunch',
      },
    ];
    target.hotels = [target.hotels[1]];
    target.legs = [{ ...target.legs[0], nameZh: '已编辑送机' }];
    // Keep the submitted order as it was before removal. The new lunch has no explicit position.
    const update = { ...input, version: original.version, days: edited };
    const saved = await h.call<WebsiteItinerary>(owner, 'PUT', path, update);
    await h.call(owner, 'PUT', path, update, 409, 'ITINERARY_VERSION_CONFLICT');
    const reopened = await h.call<WebsiteItinerary>(owner, 'GET', path);
    assert.deepEqual(reopened.days, saved.days);
    assert.equal(reopened.version, original.version + 1);
    assert.deepEqual(reopened.serviceDates, dates);
    assert.deepEqual(reopened.days.slice(0, 2), original.days.slice(0, 2));
    assert.deepEqual(reopened.days[2], {
      ...target,
      eventOrder: [guide, stops[0], leg.id, ...stops.slice(1), secondHotel.id],
    });
    console.log(
      'Verified day card edits, order, nightly fields, other days and stale-version rejection over HTTP.',
    );
  } finally {
    await h.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
