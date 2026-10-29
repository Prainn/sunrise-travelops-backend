import { websiteLogChanges } from './website-log-changes';
import type {
  WebsiteInquiry,
  WebsiteItinerary,
  WebsiteDay,
} from './website.types';

function day(id: string, dayNumber: number): WebsiteDay {
  return {
    id,
    dayNumber,
    departCityId: 'city',
    endCityId: 'city',
    overnightCityId: null,
    items: [
      {
        id: `item-${id}`,
        attractionId: null,
        nameZh: '景点',
        nameEn: 'Attraction',
        descriptionZh: '',
        descriptionEn: '',
        appears: true,
        feeState: 'INCLUDED',
      },
    ],
    legs: [],
    hotels: [],
    meals: [],
    services: [],
    guideLanguage: '',
  };
}
function plan(): WebsiteItinerary {
  return {
    id: 'plan',
    inquiryId: 'inquiry',
    businessUnit: 'website',
    code: 'WIT-1',
    title: '行程',
    duration: 2,
    startDate: null,
    pax: null,
    configVersion: 1,
    status: 'draft',
    version: 1,
    createdAt: '',
    updatedAt: '',
    days: [day('day-1', 1), day('day-2', 2)],
    deletedDays: [],

    vehiclePrices: [
      {
        vehicleType: '7_seat',
        hotelTier: 'A',
        includesDriver: true,
        includesGuide: true,
        unitPrice: '100.00',
      },
    ],
  };
}

describe('website field audit', () => {
  it('ignores object key order and system version/timestamp changes', () => {
    const before = plan();
    const after = structuredClone(before);
    after.version++;
    after.updatedAt = 'later';
    after.days[0].items[0] = Object.fromEntries(
      Object.entries(after.days[0].items[0]).reverse(),
    ) as WebsiteDay['items'][number];
    expect(websiteLogChanges(before, after)).toEqual([]);
  });

  it('uses stable IDs and preserves multilingual context for edits and removals', () => {
    const before = plan();
    const after = structuredClone(before);
    after.days[0].items[0].feeState = 'EXCLUDED';
    after.days[1].items = [];
    const changes = websiteLogChanges(before, after);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      path: 'days[day-1].items[item-day-1].feeState',
      kind: 'changed',
      before: 'INCLUDED',
      after: 'EXCLUDED',
      context: { dayNumber: 1, nameZh: '景点', nameEn: 'Attraction' },
    });
    expect(changes[1]).toMatchObject({
      path: 'days[day-2].items[item-day-2]',
      kind: 'removed',
      after: null,
      context: { dayNumber: 2, nameEn: 'Attraction' },
    });
  });

  it('records actual reordering without misidentifying items as new records', () => {
    const before = plan();
    before.days[0].items.push({ ...before.days[0].items[0], id: 'another' });
    const after = structuredClone(before);
    after.days[0].items.reverse();
    expect(websiteLogChanges(before, after)).toMatchObject([
      {
        path: 'days[day-1].items.order',
        before: ['item-day-1', 'another'],
        after: ['another', 'item-day-1'],
      },
    ]);
  });

  it('compares recycle contents by day ID and ignores unspecified recycle display order', () => {
    const before = plan();
    before.deletedDays = [
      { day: day('old-1', 1), originalDate: '2026-10-21' },
      { day: day('old-2', 1), originalDate: null },
    ];
    const after = structuredClone(before);
    after.deletedDays!.reverse();
    expect(websiteLogChanges(before, after)).toEqual([]);
    after.deletedDays![0].day.guideLanguage = 'English';
    expect(websiteLogChanges(before, after)).toMatchObject([
      {
        path: 'deletedDays[old-2].day.guideLanguage',
        before: '',
        after: 'English',
        context: { dayNumber: 1 },
      },
    ]);
  });

  it('records vehicle prices as independent fields, including clearing to null', () => {
    const before = plan();
    const after = structuredClone(before);
    after.vehiclePrices[0].unitPrice = null;
    expect(websiteLogChanges(before, after)).toEqual([
      {
        path: 'vehiclePrices.["7_seat","A"].unitPrice',
        kind: 'changed',
        before: '100.00',
        after: null,
        context: { vehicleType: '7_seat', hotelTier: 'A' },
      },
    ]);
  });

  it('ignores inquiry system fields but audits owner and business input changes', () => {
    const before = {
      id: 'inquiry',
      code: 'WIQ-1',
      ownerId: 'old',
      owner: '原负责人',
      status: 'new',
      customerName: '客户',
      version: 1,
      hasActiveTour: false,
    } as WebsiteInquiry;
    const after = {
      ...before,
      ownerId: 'new',
      owner: '新负责人',
      version: 2,
      hasActiveTour: true,
    };
    expect(
      websiteLogChanges(before, after).map((change) => change.path),
    ).toEqual(['ownerId', 'owner']);
  });
});

it('records component prices and PDF display changes with the vehicle context', () => {
  const before = plan();
  before.vehiclePrices[0].priceComponents = [
    { category: 'hotel', unitPrice: '20.00', showInPdf: false },
  ];
  const after = structuredClone(before);
  after.vehiclePrices[0].priceComponents![0].showInPdf = true;
  after.vehiclePrices[0].priceComponents![0].unitPrice = '21.00';
  const changes = websiteLogChanges(before, after);
  expect(changes.map((row) => row.path).sort()).toEqual([
    'vehiclePrices.["7_seat","A"].priceComponents.hotel.showInPdf',
    'vehiclePrices.["7_seat","A"].priceComponents.hotel.unitPrice',
  ]);
  expect(changes.every((row) => row.context?.vehicleType === '7_seat')).toBe(
    true,
  );
});
