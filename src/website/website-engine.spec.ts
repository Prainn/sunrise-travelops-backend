import { randomUUID } from 'node:crypto';
import {
  buildWebsitePreview,
  generateWebsiteDraft,
  validateWebsiteConfig,
} from './website-engine';
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
    hotels: [],
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
    canDelete: false,
    businessUnit: 'website',
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
    contactInfo: '',
    receivedAt: null,
    contactChannel: '',
    whatsappSourceId: '',
    websiteInquiryNo: '',
    landingPage: '',
    acquisitionSource: '',
    startDate: null,
    pax: null,
    destinations: [],
    internalRemark: '',
    lostReason: '',
    status: 'planning',
    version: 1,
    createdAt: '',
    updatedAt: '',
  };
  const itinerary: WebsiteItinerary = {
    businessUnit: 'website',
    id: randomUUID(),
    inquiryId: inquiry.id,
    code: 'WIT-TEST',
    title: 'UAT regression',
    duration: 2,
    startDate: null,
    pax: 3,
    arrivalTime: '',
    departureTime: '',
    configVersion: config.version,
    status: 'draft',
    version: 1,
    createdAt: '',
    updatedAt: '',

    vehiclePrices: [
      {
        vehicleType: null,
        hotelTier: 'A',
        includesDriver: false,
        includesGuide: false,
        unitPrice: '8800.00',
      },
    ],
    days: [1, 2].map((dayNumber) => ({
      id: randomUUID(),
      dayNumber,
      departCityId: kunming,
      endCityId: kunming,
      overnightCityId: dayNumber === 1 ? kunming : null,
      items: [],
      legs: [],
      guideLanguage: '',
      services: [],
      hotels:
        dayNumber === 1
          ? [
              {
                id: randomUUID(),
                tier: 'A',
                cityId: kunming,
                configHotelId: null,
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
  it('renders economy and two-star hotel alternatives in both language outputs', () => {
    const { config, inquiry, itinerary } = fixture();
    const original = itinerary.days[0].hotels[0];
    itinerary.days[0].hotels = (['C', 'D'] as const).map((tier) => ({
      ...original,
      id: randomUUID(),
      tier,
      nameZh: `酒店${tier}`,
      nameEn: `Hotel ${tier}`,
    }));
    const preview = buildWebsitePreview(inquiry, itinerary, config);
    expect(
      preview.issues.filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);
    expect(
      preview.chinese.hotelOptions.map((hotel) => [hotel.tier, hotel.hotel]),
    ).toEqual([
      ['C', '酒店C'],
      ['D', '酒店D'],
    ]);
    expect(
      preview.english.hotelOptions.map((hotel) => [hotel.tier, hotel.hotel]),
    ).toEqual([
      ['C', 'Hotel C'],
      ['D', 'Hotel D'],
    ]);
  });

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
      expect.objectContaining({
        vehicle: 'No private vehicle',
        price: 'RMB 8800.00 PP',
        hotelTier: 'A',
        pax: 3,
        totalPrice: '26400.00',
      }),
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
  it('accepts website hotel price 0 and rejects missing or negative prices', () => {
    const { config } = fixture();
    const hotel = {
      id: randomUUID(),
      status: 'enabled' as const,
      cityId: config.cities[0].id,
      nameZh: '酒店',
      nameEn: 'Hotel',
      resourceId: null,
      price: '0',
    };
    config.hotels = [hotel];
    validateWebsiteConfig(config);
    for (const price of ['', '-1', '1.234']) {
      const invalid = structuredClone(config);
      invalid.hotels[0].price = price;
      expect(() => validateWebsiteConfig(invalid)).toThrow();
    }
  });
});

describe('sequence and relaxed timing', () => {
  it('renders mixed events in order without arrival/departure warnings', () => {
    const { config, inquiry, itinerary } = fixture();
    const day = itinerary.days[0];
    day.items = [
      {
        id: randomUUID(),
        attractionId: null,
        nameZh: '景点',
        nameEn: 'Sight',
        descriptionZh: '参观景点',
        descriptionEn: 'Visit sight',
        appears: true,
        feeState: 'INCLUDED',
      },
    ];
    day.eventOrder = [
      day.legs[0].id,
      day.items[0].id,
      day.meals[0].id,
      day.legs[1].id,
      day.hotels[0].id,
    ];
    const result = buildWebsitePreview(inquiry, itinerary, config);
    expect(result.issues.some((issue) => issue.code === 'VAL-W03')).toBe(false);
    const text = result.english.itinerary[0].sightseeing;
    expect(text).toContain('Arrival in Kunming.');
    expect(text).toContain('Overnight in Kunming.');
    expect(text.indexOf('Kunming → Dali')).toBeLessThan(
      text.indexOf('Visit sight'),
    );
    expect(text.indexOf('Visit sight')).toBeLessThan(text.indexOf('Lunch'));
    expect(text.indexOf('Lunch')).toBeLessThan(text.indexOf('Dali → Kunming'));
    expect(text.indexOf('Dali → Kunming')).toBeLessThan(
      text.indexOf('Manual Hotel'),
    );
  });
  it('requires a choice for multiple resource vehicles and keeps PDF visibility on the itinerary', () => {
    const { config, itinerary } = fixture();
    config.routes = [
      {
        id: randomUUID(),
        status: 'enabled',
        fromCityId: config.cities[0].id,
        toCityId: config.cities[1].id,
        mode: 'private_vehicle',
        nameZh: '路线',
        nameEn: 'Route',
        feeState: 'INCLUDED',
        vehicleOptions: [
          { vehicleType: '5_seat', durationMinutes: 180 },
          { vehicleType: '7_seat', durationMinutes: 210 },
        ],
      },
    ];
    config.skeletons = [
      {
        id: randomUUID(),
        status: 'enabled',
        nameZh: '骨架',
        nameEn: 'Skeleton',
        days: config.cities.map((city) => ({
          cityId: city.id,
          patternId: null,
        })),
      },
    ];
    let generated = generateWebsiteDraft(
      itinerary,
      config,
      config.skeletons[0].id,
    );
    expect(generated.days[1].legs[0].vehicleType).toBeNull();
    expect(generated.days[1].legs[0].durationMinutes).toBeNull();
    expect(generated.days[1].legs[0].showInMileage).toBe(false);
    config.routes[0].vehicleOptions = [
      { vehicleType: '定制22座车', durationMinutes: 230 },
    ];
    generated = generateWebsiteDraft(itinerary, config, config.skeletons[0].id);
    expect(generated.days[1].legs[0].vehicleType).toBe('定制22座车');
    expect(generated.days[1].legs[0].durationMinutes).toBe(230);
    expect(generated.days[1].legs[0].showInMileage).toBe(false);
  });
  it('accepts same-city transport configuration', () => {
    const { config } = fixture();
    config.routes.push({
      id: randomUUID(),
      status: 'enabled',
      fromCityId: config.cities[0].id,
      toCityId: config.cities[0].id,
      mode: 'private_vehicle',
      vehicleOptions: [
        { vehicleType: '5_seat', durationMinutes: 180 },
        { vehicleType: '7_seat', durationMinutes: 210 },
      ],
      nameZh: '市内交通',
      nameEn: 'City transfer',
      feeState: 'INCLUDED',
    });
    expect(() => validateWebsiteConfig(config)).not.toThrow();
  });
});

it('generates first and last day attractions without confirmed travel times', () => {
  const { config, itinerary } = fixture();
  const cityId = config.cities[0].id;
  const attractionId = randomUUID();
  config.attractions.push({
    id: attractionId,
    cityId,
    parentId: null,
    status: 'enabled',
    nameZh: '景点',
    nameEn: 'Sight',
    resourceId: null,
    kind: 'attraction',
    chargeable: false,
    copyKey: 'sight',
    recommendedMonths: [],
  });
  config.patterns.push({
    id: randomUUID(),
    cityId,
    status: 'enabled',
    nameZh: '模板',
    nameEn: 'Pattern',
    attractionIds: [attractionId],
  });
  config.skeletons.push({
    id: randomUUID(),
    status: 'enabled',
    nameZh: '骨架',
    nameEn: 'Skeleton',
    days: [1, 2].map(() => ({ cityId, patternId: config.patterns[0].id })),
  });
  const generated = generateWebsiteDraft(
    itinerary,
    config,
    config.skeletons[0].id,
  );
  expect(
    generated.days.map((day) => day.items.map((item) => item.attractionId)),
  ).toEqual([[attractionId], [attractionId]]);
});

describe('website report plans and mileage', () => {
  it('prices vehicle × hotel tiers and derives service scope from active days', () => {
    const { inquiry, itinerary, config } = fixture();
    itinerary.days[0].legs = ['5_seat', '7_seat'].map((vehicleType) => ({
      id: randomUUID(),
      routeId: null,
      fromCityId: config.cities[0].id,
      toCityId: config.cities[0].id,
      mode: 'private_vehicle',
      vehicleType,
      nameZh: '专车',
      nameEn: 'Private vehicle',
      feeState: 'INCLUDED',
    }));
    itinerary.days[0].hotels.push({
      ...itinerary.days[0].hotels[0],
      id: randomUUID(),
      tier: 'B',
    });
    itinerary.days[0].guideLanguage = 'English';
    itinerary.vehiclePrices = ['5_seat', '7_seat'].flatMap((vehicleType) =>
      (['A', 'B'] as const).map((hotelTier) => ({
        vehicleType,
        hotelTier,
        includesDriver: false,
        includesGuide: false,
        unitPrice: hotelTier === 'A' ? '8641' : '6921',
      })),
    );
    const preview = buildWebsitePreview(inquiry, itinerary, config);
    expect(preview.schemaVersion).toBe(5);
    expect(
      preview.english.quotation.map((row) => [
        row.vehicleType,
        row.hotelTier,
        row.totalPrice,
      ]),
    ).toEqual([
      ['5_seat', 'A', '25923.00'],
      ['7_seat', 'A', '25923.00'],
      ['5_seat', 'B', '20763.00'],
      ['7_seat', 'B', '20763.00'],
    ]);
    expect(
      preview.english.quotation.every(
        (row) =>
          row.includesDriver && row.includesGuide && row.plan === undefined,
      ),
    ).toBe(true);
    expect(preview.english.inclusions).toContain(
      'D1: Tour guide (English) included.',
    );
    expect(
      preview.english.inclusions.some((line) =>
        line.includes('Private driver included on D1.'),
      ),
    ).toBe(true);
    expect(preview.chinese.quotation[0].hotelCategory).toBe('高端五星');
    expect(preview.english.hotelOptions[0]).toMatchObject({
      startDay: 1,
      endDay: 1,
      nights: 1,
      breakfastIncluded: true,
    });
    itinerary.days[0].guideLanguage = '';
    itinerary.deletedDays = [
      {
        day: {
          ...structuredClone(itinerary.days[0]),
          guideLanguage: 'English',
        },
        originalDate: null,
      },
    ];
    expect(
      buildWebsitePreview(inquiry, itinerary, config).english.quotation.every(
        (row) => row.includesGuide === false,
      ),
    ).toBe(true);
    itinerary.days[1].overnightCityId = config.cities[0].id;
    expect(
      buildWebsitePreview(inquiry, itinerary, config).issues.some(
        (issue) => issue.code === 'VAL-E09' && issue.dayNumber === 2,
      ),
    ).toBe(true);
  });

  it('keeps zero, null pax and maximum-precision totals distinct', () => {
    const { inquiry, itinerary, config } = fixture();
    itinerary.vehiclePrices[0].unitPrice = '0';
    expect(
      buildWebsitePreview(inquiry, itinerary, config).english.quotation[0]
        .totalPrice,
    ).toBe('0.00');
    itinerary.pax = null;
    const pending = buildWebsitePreview(inquiry, itinerary, config);
    expect(pending.issues).toContainEqual(
      expect.objectContaining({ code: 'VAL-E08', severity: 'ERROR' }),
    );
    expect(pending.english.quotation[0].totalPrice).toBeNull();
    itinerary.pax = 10000;
    itinerary.vehiclePrices[0].unitPrice = '9999999999.99';
    expect(
      buildWebsitePreview(inquiry, itinerary, config).english.quotation[0]
        .totalPrice,
    ).toBe('99999999999900.00');
    itinerary.pax = 3;
    itinerary.vehiclePrices[0].unitPrice = '0.29';
    expect(
      buildWebsitePreview(inquiry, itinerary, config).english.quotation[0]
        .totalPrice,
    ).toBe('0.87');
  });

  it('uses day/event order, vehicle types and authored values for mileage, preserving unknowns', () => {
    const { inquiry, itinerary, config } = fixture();
    const day = itinerary.days[0];
    day.legs = [80, 190, 0].map((distance, index) => ({
      id: randomUUID(),
      routeId: null,
      fromCityId: config.cities[0].id,
      toCityId: config.cities[0].id,
      mode: 'private_vehicle',
      vehicleType: index === 0 ? '5_seat' : '7_seat',
      nameZh: '包车',
      nameEn: 'Private vehicle',
      feeState: 'INCLUDED',
      distanceKm: String(distance),
      durationMinutes: index === 1 ? null : 90,
      showInMileage: index !== 2,
    }));
    day.eventOrder = [day.legs[1].id, day.legs[0].id];
    itinerary.days[1].legs = [
      { ...day.legs[0], id: randomUUID(), distanceKm: null },
    ];
    const preview = buildWebsitePreview(inquiry, itinerary, config);
    expect(preview.english.mileage?.map((row) => row.distanceKm)).toEqual([
      '190',
      '80',
      null,
    ]);
    expect(preview.chinese.mileage?.map((row) => row.vehicleType)).toEqual([
      '7_seat',
      '5_seat',
      '5_seat',
    ]);
    expect(preview.english.mileage?.[0].durationMinutes).toBeNull();
    expect(preview.chinese.mileage?.[0].transport).toContain('7');
    day.legs[0].distanceKm = '999';
    expect(preview.chinese.mileage?.[1].distanceKm).toBe('80');
    day.legs[0].vehicleType = null;
    expect(
      buildWebsitePreview(inquiry, itinerary, config).issues,
    ).toContainEqual(expect.objectContaining({ code: 'ITINERARY_INVALID' }));
    config.cities[0].status = 'disabled';
    expect(
      buildWebsitePreview(inquiry, itinerary, config).issues,
    ).toContainEqual(expect.objectContaining({ code: 'CONFIG_NOT_READY' }));
  });

  it('renders each authored Chinese and English attraction once without sample filler', () => {
    const { inquiry, itinerary, config } = fixture();
    itinerary.days[0].items = [
      {
        id: randomUUID(),
        attractionId: null,
        nameZh: '石林',
        nameEn: 'Stone Forest',
        descriptionZh: '游览石林，乘景区观光车。',
        descriptionEn: 'Visit Stone Forest by shuttle.',
        appears: true,
        feeState: 'INCLUDED',
      },
    ];
    const preview = buildWebsitePreview(inquiry, itinerary, config);
    expect(
      preview.chinese.itinerary[0].sightseeing.match(/游览石林/g),
    ).toHaveLength(1);
    expect(
      preview.english.itinerary[0].sightseeing.match(/Visit Stone Forest/g),
    ).toHaveLength(1);
  });
});

it('freezes the complete sum but exposes only selected component prices in both languages', () => {
  const { inquiry, itinerary, config } = fixture();
  itinerary.vehiclePrices[0].priceComponents = [
    { category: 'hotel', unitPrice: '2000', showInPdf: true },
    { category: 'guide', unitPrice: '1000', showInPdf: false },
    { category: 'vehicle', unitPrice: '3000', showInPdf: false },
    { category: 'attraction', unitPrice: '2000', showInPdf: true },
    { category: 'meal', unitPrice: '2000', showInPdf: false },
  ];
  itinerary.vehiclePrices[0].unitPrice = '1'; // The service and engine do not trust a submitted total.
  const preview = buildWebsitePreview(inquiry, itinerary, config);
  expect(preview.schemaVersion).toBe(4);
  for (const output of [preview.chinese, preview.english]) {
    expect(output.quotation[0].unitPrice).toBe('10000.00');
    expect(output.quotation[0].totalPrice).toBe('30000.00');
    expect(output.quotation[0].priceComponents).toEqual([
      { category: 'hotel', unitPrice: '2000.00' },
      { category: 'attraction', unitPrice: '2000.00' },
    ]);
  }
});
