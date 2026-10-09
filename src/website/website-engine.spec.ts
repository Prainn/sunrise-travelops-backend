import { randomUUID } from 'node:crypto';
import { buildWebsitePreview, validateWebsiteConfig } from './website-engine';
import type {
  WebsiteConfig,
  WebsiteInquiry,
  WebsiteItinerary,
} from './website.types';

function fixture() {
  const kunming = randomUUID();
  const dali = randomUUID();
  const config: WebsiteConfig = {
    version: 1,
    cities: [
      {
        id: kunming,
        status: 'enabled',
        nameZh: '昆明',
        nameEn: 'Kunming',
        resourceId: null,
      },
      {
        id: dali,
        status: 'enabled',
        nameZh: '大理',
        nameEn: 'Dali',
        resourceId: null,
      },
    ],
    attractions: [],
    routes: [],
    patterns: [],
    skeletons: [],
    templates: [
      ['arrival-basic', '抵达{city}。', 'Arrival in {city}.'],
      ['departure-basic', '从{city}离开。', 'Departure from {city}.'],
      ['overnight', '住宿{city}。', 'Overnight in {city}.'],
      [
        'private-driver',
        '车辆及司机包含。',
        'Private vehicle and driver included.',
      ],
      ['included-service', '包含{service}。', '{service} included.'],
      [
        'hotel-breakfast',
        '{hotel}住宿及早餐。',
        'Hotel {hotel} with breakfast included.',
      ],
      [
        'hsr-second-class',
        '乘坐高铁前往{city}，包含二等座车票。',
        'Take the high-speed rail to {city}; a second-class seat is included.',
      ],
      [
        'optional-not-included',
        '{component}可选，不含费用。',
        '{component} optional and not included.',
      ],
      ['peak-season', '旺季重新确认。', 'Reconfirm peak-season arrangements.'],
      [
        'hotel-substitution',
        '客满时安排同等级酒店。',
        'If the selected hotel is fully booked, another hotel of the same category will be arranged subject to actual availability.',
      ],
      ['no-shopping', '无购物。', 'NO SHOPPING.'],
    ].map(([code, zh, en]) => ({
      id: randomUUID(),
      name: code,
      code,
      zh,
      en,
      status: 'enabled',
    })),
  };
  const inquiry: WebsiteInquiry = {
    hasActiveTour: false,
    id: randomUUID(),
    code: 'WIQ-TEST',
    countryItemId: randomUUID(),
    countryCode: 'CHN',
    countryOrRegion: '中国',
    ownerId: randomUUID(),
    owner: 'Test',
    customerName: 'Test',
    plannedDays: 2,
    requirements: 'UAT regression',
    phone: '',
    email: '',
    startDate: null,
    pax: null,
    arrivalTime: '',
    departureTime: '',
    destinations: [],
    internalRemark: '',
    lostReason: '',
    status: 'planning',
    version: 1,
    createdAt: '',
    updatedAt: '',
  };
  const itinerary: WebsiteItinerary = {
    id: randomUUID(),
    inquiryId: inquiry.id,
    code: 'WIT-TEST',
    title: 'UAT regression',
    duration: 2,
    startDate: null,
    pax: null,
    arrivalTime: '',
    departureTime: '',
    configVersion: config.version,
    status: 'draft',
    version: 1,
    createdAt: '',
    updatedAt: '',
    vehiclePrices: [{ vehicleType: '7_seat', unitPrice: '8800.00' }],
    days: [1, 2].map((dayNumber) => ({
      id: randomUUID(),
      dayNumber,
      departCityId: kunming,
      endCityId: kunming,
      overnightCityId: dayNumber === 1 ? kunming : null,
      items: [],
      legs: [],
      guideLanguage: '',
      guideScope: '',
      services: [],
      hotels:
        dayNumber === 1
          ? [
              {
                id: randomUUID(),
                tier: 'A',
                cityId: kunming,
                resourceId: null,
                nameZh: '手填酒店',
                nameEn: 'Manual Hotel',
                roomType: '',
                breakfastIncluded: true,
              },
            ]
          : [],
      meals: (['lunch', 'dinner'] as const).map((slot) => ({
        id: randomUUID(),
        slot,
        resourceId: null,
        restaurantZh: '',
        restaurantEn: '',
        feeState: 'SELF_PAY',
      })),
    })),
  };
  itinerary.days[0].legs = [
    [kunming, dali],
    [dali, kunming],
  ].map(([fromCityId, toCityId]) => ({
    id: randomUUID(),
    routeId: null,
    fromCityId,
    toCityId,
    mode: 'hsr',
    nameZh: '高铁',
    nameEn: 'High-speed rail',
    feeState: 'INCLUDED',
  }));
  return { config, inquiry, itinerary };
}

describe('website UAT output', () => {
  it('renders each HSR leg destination in both languages and accepts a manual hotel without costs', () => {
    const { config, inquiry, itinerary } = fixture();
    validateWebsiteConfig(config);
    const preview = buildWebsitePreview(inquiry, itinerary, config);
    expect(
      preview.issues.filter(({ severity }) => severity === 'ERROR'),
    ).toEqual([]);
    expect(preview.english.inclusions).toEqual(
      expect.arrayContaining([
        'Take the high-speed rail to Dali; a second-class seat is included.',
        'Take the high-speed rail to Kunming; a second-class seat is included.',
      ]),
    );
    expect(preview.chinese.inclusions).toEqual(
      expect.arrayContaining([
        '乘坐高铁前往大理，包含二等座车票。',
        '乘坐高铁前往昆明，包含二等座车票。',
      ]),
    );
    expect(preview.english.hotelOptions[0].hotel).toBe('Manual Hotel');
    expect(preview.english.quotation).toEqual([
      { vehicle: '7-seat vehicle', price: 'RMB 8800.00 PP' },
    ]);
  });

  it('does not include the HSR ticket when that leg is self-pay', () => {
    const { config, inquiry, itinerary } = fixture();
    itinerary.days[0].legs[0].feeState = 'SELF_PAY';
    const preview = buildWebsitePreview(inquiry, itinerary, config);
    expect(
      preview.english.inclusions.some((line) => line.includes('rail to Dali')),
    ).toBe(false);
    expect(
      preview.chinese.inclusions.some((line) => line.includes('高铁前往大理')),
    ).toBe(false);
  });

  it('excludes self-pay lunch and dinner while preserving an explicitly included lunch', () => {
    const { config, inquiry, itinerary } = fixture();
    const defaultPreview = buildWebsitePreview(inquiry, itinerary, config);
    expect(defaultPreview.english.exclusions).toContain(
      'Lunch and dinner, unless explicitly included in this quotation.',
    );
    expect(defaultPreview.chinese.exclusions).toContain(
      '午餐和晚餐（本报价明确包含的餐食除外）。',
    );
    itinerary.days[0].meals[0].feeState = 'INCLUDED';
    const preview = buildWebsitePreview(inquiry, itinerary, config);
    expect(preview.english.inclusions).toContain('Lunch included.');
    expect(preview.chinese.inclusions).toContain('包含午餐。');
    expect(preview.english.inclusions).not.toContain('Dinner included.');
    expect(preview.chinese.inclusions).not.toContain('包含晚餐。');
    expect(preview.english.exclusions).toEqual(
      defaultPreview.english.exclusions,
    );
    expect(preview.chinese.exclusions).toEqual(
      defaultPreview.chinese.exclusions,
    );
  });

  it('rejects variables from another purpose in either language before saving configuration', () => {
    const { config } = fixture();
    config.templates.push({
      id: randomUUID(),
      name: '景点正文',
      code: 'lake-copy',
      status: 'enabled',
      zh: '参观{city}的{attraction}。',
      en: 'Visit {attraction} in {city}.',
    });
    validateWebsiteConfig(config);
    for (const [code, language, copy] of [
      ['private-driver', 'en', 'Transfer in {city}.'],
      ['hsr-second-class', 'zh', '前往{hotel}。'],
      ['lake-copy', 'en', '{language} guide.'],
    ] as const) {
      const invalid = structuredClone(config);
      invalid.templates.find((template) => template.code === code)![language] =
        copy;
      expect(() => validateWebsiteConfig(invalid)).toThrow(/未支持的变量/);
    }
  });
});
