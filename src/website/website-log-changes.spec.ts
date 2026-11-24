import { targetNames } from './website-log-evidence';
import { renderLogNames } from './website-log-display';
import type { WebsiteLogChange } from './website.types';
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
  it('excludes day remarks from both field edits and whole-day report entries', () => {
    const before = plan();
    const after = structuredClone(before);
    after.days[0].internalRemark = '仅供计调';
    expect(websiteLogChanges(before, after)).toEqual([]);
    after.deletedDays = [{ originalDate: null, day: after.days.shift()! }];
    for (const changes of [
      websiteLogChanges(undefined, after),
      websiteLogChanges(before, after),
    ])
      expect(JSON.stringify(changes)).not.toMatch(/internalRemark|仅供计调/);
  });
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

describe('readable website log differences', () => {
  function projected(before: WebsiteItinerary, after: WebsiteItinerary) {
    const raw = websiteLogChanges(before, after);
    const { names } = targetNames(raw, before, after);
    return { raw, display: renderLogNames(raw, names) };
  }

  it('merges only a matching category projection and preserves the guide and event names', () => {
    const before = plan(),
      d = before.days[0],
      first = d.items[0];
    d.items.push({ ...first, id: 'second', nameZh: '第二站' });
    d.guideLanguage = '英语';
    d.eventOrder = [first.id, d.id + '-guide', 'second'];
    const after = structuredClone(before);
    after.days[0].items.reverse();
    after.days[0].eventOrder = ['second', d.id + '-guide', first.id];
    const { raw, display } = projected(before, after);
    expect(raw).toHaveLength(2);
    expect(display).toHaveLength(1);
    expect(display[0]).toMatchObject({
      fields: ['days', 'eventOrder'],
      after: [
        { ref: 'item', nameZh: '第二站' },
        { ref: 'guide', nameZh: '英语' },
        { ref: 'item', nameZh: '景点' },
      ],
    });
    after.days[0].eventOrder = [d.id + '-guide', first.id, 'second'];
    expect(
      projected(before, after).display.map((v) => v.fields.at(-1)),
    ).toEqual(expect.arrayContaining(['order', 'eventOrder']));
  });

  it('suppresses hotel replacement order noise and detects a real first reorder from the implicit order', () => {
    const before = plan(),
      d = before.days[0];
    d.hotels = [
      {
        id: 'old',
        tier: 'B',
        cityId: 'city',
        configHotelId: null,
        resourceId: null,
        nameZh: '旧酒店',
        nameEn: '',
        roomType: '',
        breakfastIncluded: true,
      },
    ];
    d.eventOrder = [d.items[0].id, 'old'];
    const after = structuredClone(before);
    after.days[0].hotels[0] = { ...d.hotels[0], id: 'new', nameZh: '新酒店' };
    after.days[0].eventOrder = [d.items[0].id, 'new'];
    const display = projected(before, after).display;
    expect(display.map((c) => [c.fields.at(-1), c.kind])).toEqual([
      ['hotels', 'removed'],
      ['hotels', 'added'],
    ]);
    d.eventOrder = [];
    const reordered = structuredClone(before);
    reordered.days[0].eventOrder = ['old', d.items[0].id];
    expect(projected(before, reordered).display[0]).toMatchObject({
      fields: ['days', 'eventOrder'],
      before: [{ ref: 'item' }, { ref: 'hotel' }],
      after: [{ ref: 'hotel' }, { ref: 'item' }],
    });
  });

  it('keeps catalogue types, previous names and free text distinct; parses custom price keys with punctuation', () => {
    const state = {
      ownerId: 'old',
      owner: '原负责人',
      countryItemId: 'one',
      countryOrRegion: '马来西亚',
      countryCode: 'MYS',
    };
    const next = {
      ownerId: 'new',
      owner: '新负责人',
      countryItemId: 'two',
      countryOrRegion: '中国',
      countryCode: 'CHN',
    };
    const raw: WebsiteLogChange[] = Object.keys(state).map((k) => ({
      kind: 'changed',
      path: k,
      before: state[k as keyof typeof state],
      after: next[k as keyof typeof next],
    }));
    raw.push(
      {
        kind: 'changed',
        path: 'vehiclePrices.["定制.车]","A"].priceComponents.hotel.unitPrice',
        before: '1.00',
        after: '2.00',
        context: { hotelTier: 'A' },
      },
      {
        kind: 'added',
        path: 'serviceDates',
        before: null,
        after: ['2026-11-24'],
      },
    );
    const result = renderLogNames(raw, targetNames(raw, state, next).names);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({
      before: { ref: 'owner', nameZh: '原负责人' },
      after: { ref: 'owner', nameZh: '新负责人' },
    });
    expect(result[1]).toMatchObject({
      before: { ref: 'country', code: 'MYS' },
      after: { ref: 'country', nameZh: '中国' },
    });
    expect(result[2]).toMatchObject({
      fields: ['vehiclePrices', 'priceComponents', 'hotel', 'unitPrice'],
      context: { vehicleType: '定制.车]', hotelTier: 'A' },
    });
    expect(result[3]).toMatchObject({ kind: 'added', before: null });
  });

  it('uses the correct reference kind for nested recycle and draft entries and marks a missing name', () => {
    const before = plan(),
      after = structuredClone(before),
      d = after.days[0];
    d.meals = [
      {
        id: 'lunch',
        slot: 'lunch',
        resourceId: 'restaurant',
        restaurantZh: '原餐标',
        restaurantEn: 'Meal',
        feeState: 'INCLUDED',
      },
    ];
    after.reorderDraft = {
      dayIds: [d.id],
      addedDayIds: [],
      deletedDays: [],
      placements: [{ dayId: d.id, itemIds: ['copy', 'missing'] }],
      copies: [
        {
          id: 'copy',
          sourceId: 'lunch',
          parentId: 'lunch',
          dayId: d.id,
          placed: true,
        },
      ],
      overnight: [],
    };
    const { display } = projected(before, after);
    const board = display.find((c) => c.fields[0] === 'reorderDraft')!;
    expect(board.after).toMatchObject({
      placements: [
        {
          dayId: { ref: 'day', dayNumber: 1 },
          itemIds: [{ ref: 'meal', nameZh: '原餐标' }, { ref: 'event' }],
        },
      ],
    });
    expect(
      display.find((c) => c.fields.includes('meals'))?.after,
    ).toMatchObject({
      resourceId: { ref: 'restaurant', nameZh: '原餐标', source: 'entry' },
    });
    const recycled = structuredClone(after);
    recycled.deletedDays = [
      { day: recycled.days.shift()!, originalDate: '2026-11-24' },
    ];
    const entry = projected(after, recycled).display.find(
      (c) => c.fields[0] === 'deletedDays',
    )!;
    expect(entry.after).toMatchObject({
      day: { meals: [{ resourceId: { ref: 'restaurant' } }] },
    });
  });
});
