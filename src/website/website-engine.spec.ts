import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { WebsiteAttractionDto, WebsiteConfigDto } from './website.dto';
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
  it('prices only selected room nights, preserves group cents and keeps tiered quotes independent', () => {
    const { itinerary, config, inquiry } = fixture();
    itinerary.hotelPricingMode = 'nightly';
    itinerary.startDate = '2026-11-27';
    itinerary.nightlyShowHotelPrice = true;
    const [first, second] = itinerary.days;
    const original = first.hotels[0];
    Object.assign(original, {
      nightlySelected: true,
      nightlyRate: '264.00',
      nightlyRooms: 2,
    });
    first.hotels.push({
      ...original,
      id: randomUUID(),
      nightlyOnly: true,
      roomType: 'Single',
      nightlyRooms: 1,
      nightlyRate: '100.01',
    });
    first.hotels.push({
      ...original,
      id: randomUUID(),
      tier: 'B',
      nameEn: 'Unselected',
      nightlySelected: false,
      nightlyRate: '990',
    });
    second.overnightCityId = original.cityId;
    second.hotels = [
      {
        ...original,
        id: randomUUID(),
        tier: 'C',
        nameEn: 'Second Hotel',
        nightlyRooms: 1,
        nightlyRate: '615',
      },
    ];
    const preview = () => buildWebsitePreview(inquiry, itinerary, config);
    const result = preview();
    expect(result.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
    for (const language of [result.chinese, result.english]) {
      expect(language.hotelOptions.map((h) => h.subtotal)).toEqual([
        '528.00',
        '100.01',
        '615.00',
      ]);
      expect(language.hotelOptions[0].checkoutDate).toBe('2026-11-28');
      expect(language.nightlyHotelTotal).toBe('1243.01');
      expect(language.quotation).toHaveLength(1);
      expect(language.quotation[0]).toMatchObject({
        unitPrice: '414.34',
        totalPrice: '1243.01',
      });
    }
    expect(JSON.stringify(result.english)).not.toContain('Unselected');
    itinerary.nightlyShowHotelPrice = false;
    expect(preview().english.hotelOptions[0]).not.toHaveProperty('nightlyRate');
    expect(preview().english).not.toHaveProperty('nightlyHotelTotal');
    second.hotels[0].nightlyRate = null;
    expect(preview().issues).toContainEqual(
      expect.objectContaining({ code: 'VAL-E06', dayNumber: 2 }),
    );
    itinerary.hotelPricingMode = 'tiered';
    const tiered = preview();
    expect(tiered.english.quotation[0].unitPrice).toBe('8800.00');
    expect(tiered.english.hotelOptions.map((h) => h.roomType)).not.toContain(
      'Single',
    );
    expect(tiered.issues).toContainEqual(
      expect.objectContaining({ code: 'VAL-E09' }),
    );
  });
  it('places marked descriptions around the ordered sights in each language on a one-day visit', () => {
    const { config, inquiry, itinerary } = fixture();
    const first = itinerary.days[0];
    itinerary.days = [first];
    itinerary.duration = 1;
    const [arrival, departure] = first.legs;
    Object.assign(arrival, {
      isAirportPickup: true,
      nameZh: '机场到酒店',
      nameEn: 'Arrivals to hotel',
    });
    Object.assign(departure, {
      isAirportDropoff: true,
      nameZh: '酒店到机场',
      nameEn: 'Hotel to departures',
    });
    first.items = ['A', 'B'].map((name) => ({
      id: randomUUID(),
      attractionId: null,
      nameZh: name,
      nameEn: name,
      appears: true,
      descriptionZh: `游览 ${name}`,
      descriptionEn: `Visit ${name}`,
      feeState: 'SELF_PAY',
    }));
    first.eventOrder = [
      departure.id,
      first.items[1].id,
      first.items[0].id,
      arrival.id,
    ];
    const preview = buildWebsitePreview(inquiry, itinerary, config);
    expect(preview.chinese.itinerary[0].sightseeing).toBe(
      '机场到酒店\n游览 B\n游览 A\n酒店到机场',
    );
    expect(preview.english.itinerary[0].sightseeing).toBe(
      'Arrivals to hotel\nVisit B\nVisit A\nHotel to departures',
    );
    expect(preview.english.mileage).toEqual([]);
    first.items = [];
    first.legs = [{ ...arrival, isAirportDropoff: true, nameZh: ' ' }];
    const combined = buildWebsitePreview(inquiry, itinerary, config);
    expect(combined.english.itinerary[0].sightseeing).toBe('Arrivals to hotel');
    expect(combined.chinese.itinerary[0].sightseeing).toBe(
      '根据航班时间接机。\n根据航班时间送机。',
    );
    first.legs[0].nameEn = '';
    expect(
      buildWebsitePreview(inquiry, itinerary, config).english.itinerary[0]
        .sightseeing,
    ).toBe(
      'Airport pickup timed to your flight.\nAirport drop-off timed to your flight.',
    );
    expect(
      buildWebsitePreview(
        { ...inquiry, businessUnit: 'linxi' },
        itinerary,
        config,
      ).chinese.itinerary[0].sightseeing,
    ).toBe('');
  });
  it('starts a new city and hotel/meal segment after each unserved date', () => {
    const { config, itinerary } = fixture();
    const [a, b] = config.cities;
    const skeleton = {
      id: randomUUID(),
      nameZh: '路线',
      nameEn: 'Route',
      status: 'enabled' as const,
      days: [a, b, a].map((city) => ({ cityId: city.id, patternId: null })),
    };
    config.skeletons.push(skeleton);
    const generated = generateWebsiteDraft(
      {
        ...itinerary,
        duration: 3,
        serviceDates: ['2026-11-21', '2026-11-23', '2026-11-24'],
      },
      config,
      skeleton.id,
    );
    expect(generated.days.map((day) => day.departCityId)).toEqual([
      a.id,
      b.id,
      b.id,
    ]);
    expect(generated.days.map((day) => day.hotels.length)).toEqual([0, 1, 0]);
    expect(generated.days.map((day) => day.meals[0].feeState)).toEqual([
      'SELF_PAY',
      'SELF_PAY',
      'INCLUDED',
    ]);
  });
  it('uses calendar gaps for routes, hotel nights and seasonal checks in both languages', () => {
    const { config, inquiry, itinerary } = fixture();
    const dates = ['2026-11-21', '2026-12-23', '2026-12-24', '2027-01-01'];
    inquiry.serviceDates = itinerary.serviceDates = dates;
    inquiry.startDate = itinerary.startDate = dates[0];
    itinerary.duration = 4;
    const template = itinerary.days[0];
    itinerary.days = dates.map((_, i) => ({
      ...structuredClone(template),
      id: randomUUID(),
      dayNumber: i + 1,
      legs: [],
    }));
    const preview = buildWebsitePreview(inquiry, itinerary, config);
    for (const output of [preview.english, preview.chinese]) {
      expect(output.itinerary.map((row) => row.day)).toEqual(dates);
      expect(
        output.hotelOptions.map((stay) => [
          stay.startDate,
          stay.endDate,
          stay.nights,
        ]),
      ).toEqual([
        [dates[0], dates[0], 1],
        [dates[1], dates[2], 2],
        [dates[3], dates[3], 1],
      ]);
    }
    const city = config.cities[1];
    const attraction = {
      id: randomUUID(),
      status: 'enabled' as const,
      cityId: city.id,
      parentId: null,
      resourceId: null,
      kind: 'attraction' as const,
      nameZh: '冬景',
      nameEn: 'Winter',
      descriptionZh: '赏景',
      descriptionEn: 'Sightseeing',
      chargeable: false,
      price: '0.00',
      recommendedMonths: [12],
    };
    config.attractions.push(attraction);
    itinerary.days[1].items = [
      {
        ...attraction,
        attractionId: attraction.id,
        appears: true,
        feeState: 'INCLUDED',
      },
    ];
    itinerary.days[1].departCityId = itinerary.days[1].endCityId = city.id;
    const issues = buildWebsitePreview(inquiry, itinerary, config).issues;
    expect(issues.filter((issue) => issue.code === 'VAL-W02')).toEqual([]);
    expect(
      issues
        .filter((issue) => issue.code === 'VAL-E03')
        .map((issue) => issue.dayNumber),
    ).toEqual([3]);
  });
  it.each([null, '7_seat'])(
    'quotes a hotel-free itinerary with overnight cities and vehicle %s',
    (vehicleType) => {
      const { config, inquiry, itinerary } = fixture();
      itinerary.deletedDays = [
        { day: structuredClone(itinerary.days[0]), originalDate: null },
      ];
      itinerary.days.forEach((day) => (day.hotels = []));
      if (vehicleType)
        itinerary.days[0].legs = [
          {
            id: randomUUID(),
            routeId: null,
            fromCityId: config.cities[0].id,
            toCityId: config.cities[0].id,
            mode: 'private_vehicle',
            vehicleType,
            nameZh: '专车',
            nameEn: 'Private vehicle',
            feeState: 'INCLUDED',
          },
        ];
      itinerary.vehiclePrices = [
        {
          vehicleType,
          hotelTier: null,
          includesDriver: false,
          includesGuide: false,
          unitPrice: '500.00',
        },
      ];
      const preview = buildWebsitePreview(inquiry, itinerary, config);
      expect(preview.validationVersion).toBe(7);
      expect(
        preview.issues.filter((issue) => issue.severity === 'ERROR'),
      ).toEqual([]);
      for (const output of [preview.chinese, preview.english]) {
        expect(output.quotation).toEqual([
          expect.objectContaining({
            vehicleType,
            hotelTier: null,
            unitPrice: '500.00',
            totalPrice: '1500.00',
          }),
        ]);
        expect(output.hotelOptions).toEqual([]);
        expect(
          output.teamStandard?.find((item) => item.category === 'hotel')
            ?.included,
        ).toEqual([]);
        expect(output.itinerary[0].meal).toBe('');
      }
      expect(preview.chinese.quotation[0].hotelCategory).toBe('未安排酒店');
      expect(preview.english.quotation[0].hotelCategory).toBe(
        'No hotel arranged',
      );
    },
  );

  it('keeps stale hotel tier prices invalid after every hotel is removed', () => {
    const { config, inquiry, itinerary } = fixture();
    itinerary.days.forEach((day) => (day.hotels = []));
    const issues = buildWebsitePreview(inquiry, itinerary, config).issues;
    expect(issues.filter((issue) => issue.code === 'VAL-E09')).toEqual([
      expect.objectContaining({
        severity: 'ERROR',
        target: { kind: 'prices' },
      }),
    ]);
  });

  it('locates the offending leg and distinguishes each quoted hotel tier on the same day', () => {
    const { config, inquiry, itinerary } = fixture();
    const day = itinerary.days[0];
    day.legs[1].mode = 'private_vehicle';
    day.hotels[0].nameEn = '';
    day.hotels.unshift({ ...day.hotels[0], id: randomUUID(), tier: 'B' });
    itinerary.vehiclePrices.push({
      ...itinerary.vehiclePrices[0],
      hotelTier: 'B',
    });
    const issues = buildWebsitePreview(inquiry, itinerary, config).issues;
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'ITINERARY_INVALID',
        dayNumber: 1,
        target: { kind: 'event', id: day.legs[1].id },
      }),
    );
    expect(
      issues
        .filter((issue) => issue.code === 'VAL-E09' && issue.dayNumber === 1)
        .map((issue) => issue.target),
    ).toEqual([
      { kind: 'hotel', tier: 'A' },
      { kind: 'hotel', tier: 'B' },
    ]);
  });

  it('returns one vehicle issue per offending leg, including after one is corrected', () => {
    const { config, inquiry, itinerary } = fixture();
    const day = itinerary.days[0];
    const [first, second] = day.legs;
    first.mode = second.mode = 'private_vehicle';
    const complete = { ...second, id: randomUUID(), vehicleType: '7_seat' };
    day.legs.splice(1, 0, complete);
    const vehicleTargets = () =>
      buildWebsitePreview(inquiry, itinerary, config)
        .issues.filter(
          (issue) =>
            issue.code === 'ITINERARY_INVALID' && issue.dayNumber === 1,
        )
        .map((issue) => issue.target);
    expect(vehicleTargets()).toEqual([
      { kind: 'event', id: first.id },
      { kind: 'event', id: second.id },
    ]);
    second.vehicleType = '5_seat';
    expect(vehicleTargets()).toEqual([{ kind: 'event', id: first.id }]);
  });

  it('still requires bilingual hotel names and complete stays when hotels are arranged', () => {
    const { config, inquiry, itinerary } = fixture();
    itinerary.days[1].overnightCityId = config.cities[0].id;
    const missingStay = buildWebsitePreview(inquiry, itinerary, config);
    for (const code of ['VAL-E06', 'VAL-E09'])
      expect(missingStay.issues).toContainEqual(
        expect.objectContaining({ code, severity: 'ERROR', dayNumber: 2 }),
      );
    itinerary.days[1].overnightCityId = null;
    itinerary.days[0].hotels[0].nameEn = '';
    expect(
      buildWebsitePreview(inquiry, itinerary, config).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'VAL-E06',
        severity: 'ERROR',
        dayNumber: 1,
      }),
    );
  });

  it('still requires a price and guest count for hotel-free quotations', () => {
    const { config, inquiry, itinerary } = fixture();
    itinerary.days.forEach((day) => (day.hotels = []));
    itinerary.vehiclePrices = [];
    itinerary.pax = null;
    const preview = buildWebsitePreview(inquiry, itinerary, config);
    for (const code of ['VAL-E07', 'VAL-E08'])
      expect(preview.issues).toContainEqual(
        expect.objectContaining({ code, severity: 'ERROR' }),
      );
  });

  it('previews the saved route in its own city order and checks the agreed start date', () => {
    const { config, inquiry, itinerary } = fixture();
    const [kunming, dali] = config.cities;
    itinerary.days[1].endCityId = dali.id;
    itinerary.days[1].legs = [
      {
        ...itinerary.days[0].legs[0],
        id: randomUUID(),
      },
    ];
    inquiry.destinations = [dali.id, kunming.id];
    const preview = buildWebsitePreview(inquiry, itinerary, config);
    expect(
      preview.issues.filter((issue) => issue.severity === 'ERROR'),
    ).toEqual([]);

    inquiry.startDate = '2026-12-01';
    expect(
      buildWebsitePreview(inquiry, itinerary, config).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'REQUIREMENTS_MISMATCH',
        severity: 'ERROR',
        message: '行程开始日期与询盘已确认日期不一致',
      }),
    );
  });

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
    itinerary.vehiclePrices = (['C', 'D'] as const).map((hotelTier) => ({
      ...itinerary.vehiclePrices[0],
      hotelTier,
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
      expect(() => validateWebsiteConfig(invalid)).toThrow(
        /中英文变量必须一致/,
      );
      const template = invalid.templates.find((entry) => entry.code === code)!;
      template.zh = copy;
      template.en = copy;
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
  it('keeps only attraction descriptions in event order without arrival/departure warnings', () => {
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
    expect(text).toBe('Visit sight');
    expect(result.chinese.itinerary[0].sightseeing).toBe('参观景点');
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

describe('required attraction copy at configuration write boundaries', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  function copyConfig() {
    const { config } = fixture();
    config.attractions.push({
      id: randomUUID(),
      cityId: config.cities[0].id,
      parentId: null,
      status: 'enabled',
      nameZh: '景点',
      nameEn: 'Sight',
      resourceId: null,
      kind: 'component',
      chargeable: false,
      price: '0.00',
      descriptionZh: '中文正文',
      descriptionEn: 'English copy',
      recommendedMonths: [],
    });
    return config;
  }
  it.each(['descriptionZh', 'descriptionEn'] as const)(
    'rejects missing, blank and overlong %s in single-record, bulk and direct validation',
    async (field) => {
      for (const text of [
        undefined,
        null,
        '',
        ' \t\n\u3000\u00a0',
        '中'.repeat(2001),
        '🌄'.repeat(2001),
      ]) {
        const config = copyConfig();
        Object.assign(config.attractions[0], { [field]: text });
        await expect(
          pipe.transform(config.attractions[0], {
            type: 'body',
            metatype: WebsiteAttractionDto,
          }),
        ).rejects.toThrow();
        await expect(
          pipe.transform(config, {
            type: 'body',
            metatype: WebsiteConfigDto,
          }),
        ).rejects.toThrow();
        expect(() => validateWebsiteConfig(config)).toThrow();
      }
    },
  );
  it.each(['中', 'a', '🌄'])(
    'accepts exactly 2000 %s characters at all write boundaries',
    async (character) => {
      const config = copyConfig();
      config.attractions[0].descriptionZh = character.repeat(2000);
      config.attractions[0].descriptionEn = character.repeat(2000);
      await expect(
        pipe.transform(config.attractions[0], {
          type: 'body',
          metatype: WebsiteAttractionDto,
        }),
      ).resolves.toMatchObject(config.attractions[0]);
      await expect(
        pipe.transform(config, {
          type: 'body',
          metatype: WebsiteConfigDto,
        }),
      ).resolves.toMatchObject(config);
      expect(() => validateWebsiteConfig(config)).not.toThrow();
    },
  );
});

it('generates included attractions and components without confirmed travel times', () => {
  const { config, itinerary } = fixture();
  const cityId = config.cities[0].id;
  const attractionId = randomUUID();
  const componentId = randomUUID();
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
    price: '0.00',
    descriptionZh: '游览景点',
    descriptionEn: 'Visit the sight',
    recommendedMonths: [],
  });
  config.attractions.push({
    ...config.attractions[0],
    id: componentId,
    parentId: attractionId,
    nameZh: '索道',
    nameEn: 'Cable car',
    kind: 'component',
    chargeable: true,
    price: '35.00',
  });
  config.patterns.push({
    id: randomUUID(),
    cityId,
    status: 'enabled',
    nameZh: '模板',
    nameEn: 'Pattern',
    attractionIds: [attractionId, componentId],
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
    generated.days.map((day) =>
      day.items.map(({ attractionId, feeState }) => [attractionId, feeState]),
    ),
  ).toEqual([
    [
      [attractionId, 'INCLUDED'],
      [componentId, 'INCLUDED'],
    ],
    [
      [attractionId, 'INCLUDED'],
      [componentId, 'INCLUDED'],
    ],
  ]);
  expect(generated.days[0].items[0].descriptionZh).toBe('游览景点');
  expect(generated.days[0].items[0].descriptionEn).toBe('Visit the sight');
  config.attractions[0].descriptionEn = '{hotel}';
  expect(() => validateWebsiteConfig(config)).toThrow('中英文变量必须一致');
  config.attractions[0].descriptionZh = '{hotel}';
  expect(() => validateWebsiteConfig(config)).toThrow('未支持的变量 hotel');
});

describe('website report plans and mileage', () => {
  it('uses business dictionary translations for authored language and vehicle values throughout reports', () => {
    const { inquiry, itinerary, config } = fixture();
    itinerary.days[0].guideLanguage = '英文';
    itinerary.days[0].legs = [
      {
        id: randomUUID(),
        routeId: null,
        fromCityId: config.cities[0].id,
        toCityId: config.cities[0].id,
        mode: 'private_vehicle',
        vehicleType: '9座',
        nameZh: '专车',
        nameEn: 'Private vehicle',
        feeState: 'INCLUDED',
        distanceKm: '100',
        durationMinutes: 120,
        showInMileage: true,
      },
    ];
    itinerary.vehiclePrices = [
      {
        vehicleType: '9座',
        hotelTier: 'A',
        unitPrice: '1000',
        includesDriver: true,
        includesGuide: true,
      },
    ];
    const dictionaries = {
      languages: [{ code: 'english', name: '英文', englishName: 'English' }],
      vehicles: [{ code: 'seat9', name: '9座', englishName: '9-seat vehicle' }],
    };
    const preview = buildWebsitePreview(
      inquiry,
      itinerary,
      config,
      dictionaries,
    );
    expect(preview.english.inclusions).toContain(
      'D1: Tour guide (English) included.',
    );
    expect(preview.english.inclusions).toContain(
      'Vehicle options: 9-seat vehicle; see the selected quotation option.',
    );
    expect(preview.english.quotation[0].vehicle).toBe('9-seat vehicle');
    expect(preview.english.mileage?.[0].transport).toBe('9-seat vehicle');
    expect(preview.chinese.inclusions).toContain('第1天：包含英文导游服务。');
    expect(preview.chinese.quotation[0].vehicle).toBe('9座');
    expect(
      preview.issues.some((issue) => issue.code === 'CONFIG_NOT_READY'),
    ).toBe(false);
    const missing = buildWebsitePreview(inquiry, itinerary, config);
    for (const value of ['英文', '9座']) {
      expect(
        missing.issues.some(
          (issue) =>
            issue.code === 'CONFIG_NOT_READY' &&
            issue.severity === 'ERROR' &&
            issue.message.includes(value),
        ),
      ).toBe(true);
    }
    expect(missing.english.inclusions.join(' ')).not.toMatch(/英文|9座/);
    itinerary.days[0].legs[0].vehicleType = '9_seat';
    itinerary.vehiclePrices[0].vehicleType = '9_seat';
    dictionaries.vehicles[0].englishName = '9-seat minibus';
    expect(
      buildWebsitePreview(inquiry, itinerary, config, dictionaries).english
        .quotation[0].vehicle,
    ).toBe('9-seat minibus');
  });

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
    expect(preview.schemaVersion).toBe(6);
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
    const standard = (category: string) =>
      preview.english.teamStandard?.find((row) => row.category === category)
        ?.included ?? [];
    expect(standard('service')).toEqual([
      'Guide service is included on day 1.',
    ]);
    expect(standard('driver').join(' ')).toContain(
      'Private driver included on D1.',
    );
    expect(preview.chinese.quotation[0].hotelCategory).toBe('五星');
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

  it.each([
    {
      guidedDays: [],
      zh: '全程不包含导游',
      en: 'Guide service is not included.',
    },
    {
      guidedDays: [1, 2, 3],
      zh: '全程包含导游',
      en: 'Guide service is included throughout the trip.',
    },
    {
      guidedDays: [1, 3],
      zh: '第1、3天包含导游',
      en: 'Guide service is included on days 1 and 3.',
    },
  ])(
    'summarizes guide coverage on active days $guidedDays',
    ({ guidedDays, zh, en }) => {
      const { config, inquiry, itinerary } = fixture();
      inquiry.plannedDays = itinerary.duration = 3;
      inquiry.serviceDates = itinerary.serviceDates = [
        '2026-11-23',
        '2026-11-25',
        '2026-11-30',
      ];
      itinerary.days.push({
        ...structuredClone(itinerary.days[1]),
        id: randomUUID(),
        dayNumber: 3,
      });
      for (const day of itinerary.days) {
        day.guideLanguage = guidedDays.includes(day.dayNumber) ? 'English' : '';
      }
      itinerary.deletedDays = [
        {
          day: {
            ...structuredClone(itinerary.days[1]),
            dayNumber: 4,
            guideLanguage: 'English',
          },
          originalDate: null,
        },
      ];
      const preview = buildWebsitePreview(inquiry, itinerary, config);
      expect(
        preview.chinese.teamStandard?.find(
          ({ category }) => category === 'service',
        )?.included,
      ).toEqual([zh]);
      expect(
        preview.english.teamStandard?.find(
          ({ category }) => category === 'service',
        )?.included,
      ).toEqual([en]);
      expect(
        preview.english.quotationServices?.guideServices.map(
          ({ dayNumber }) => dayNumber,
        ),
      ).toEqual(guidedDays);
    },
  );

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
      nameZh: '专车',
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
    expect(preview.chinese.itinerary[0].transportation).toBe('专车');
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
  expect(preview.schemaVersion).toBe(6);
  for (const output of [preview.chinese, preview.english]) {
    expect(output.quotation[0].unitPrice).toBe('10000.00');
    expect(output.quotation[0].totalPrice).toBe('30000.00');
    expect(output.quotation[0].priceComponents).toEqual([
      { category: 'hotel', unitPrice: '2000.00' },
      { category: 'attraction', unitPrice: '2000.00' },
    ]);
  }
});

describe('compact bilingual customer itinerary', () => {
  it('lists included tickets together across days using the bilingual templates', () => {
    const { config, inquiry, itinerary } = fixture();
    const includedService = config.templates.find(
      ({ code }) => code === 'included-service',
    )!;
    includedService.zh = '报价包含{service}。';
    includedService.en = 'The quotation includes {service}.';
    const firstEntry = {
      ...includedService,
      id: randomUUID(),
      name: 'first-entry-ticket',
      code: 'first-entry-ticket',
      zh: '行程中正式安排的收费景点均包含首次入园门票。',
      en: 'First-entry admission is included for scheduled paid attractions.',
    };
    config.templates.push(firstEntry);
    const attraction = {
      id: randomUUID(),
      status: 'enabled' as const,
      cityId: config.cities[0].id,
      parentId: null,
      resourceId: null,
      kind: 'attraction' as const,
      nameZh: '玉龙雪山',
      nameEn: 'Jade Dragon Snow Mountain',
      descriptionZh: '游览玉龙雪山。',
      descriptionEn: 'Visit Jade Dragon Snow Mountain.',
      chargeable: true,
      price: '100.00',
      recommendedMonths: [],
    };
    config.attractions.push(attraction);
    const ticket = {
      id: randomUUID(),
      attractionId: null,
      nameZh: '蓝月谷',
      nameEn: 'Blue Moon Valley',
      descriptionZh: '游览蓝月谷。',
      descriptionEn: 'Visit Blue Moon Valley.',
      appears: true,
      feeState: 'INCLUDED' as const,
    };
    itinerary.days[0].items = [
      {
        ...attraction,
        attractionId: attraction.id,
        appears: true,
        feeState: 'INCLUDED',
      },
      ticket,
    ];
    itinerary.days[1].items = [
      {
        ...ticket,
        id: randomUUID(),
        nameZh: '印象丽江',
        nameEn: 'Impression Lijiang',
      },
      {
        ...ticket,
        id: randomUUID(),
        feeState: 'OPTIONAL',
        nameZh: '索道',
        nameEn: 'Cable car',
      },
    ];

    const preview = buildWebsitePreview(inquiry, itinerary, config);
    expect(
      preview.chinese.teamStandard?.find(({ category }) => category === 'entry')
        ?.included,
    ).toEqual([`${firstEntry.zh} 报价包含蓝月谷、印象丽江。`]);
    expect(
      preview.english.teamStandard?.find(({ category }) => category === 'entry')
        ?.included,
    ).toEqual([
      `${firstEntry.en} The quotation includes Blue Moon Valley, Impression Lijiang.`,
    ]);
  });

  it('uses actual daily modes, visible attraction descriptions and the overnight city only', () => {
    const { config, inquiry, itinerary } = fixture();
    const day = itinerary.days[0];
    day.legs.push({
      ...day.legs[0],
      id: randomUUID(),
      mode: 'flight',
      feeState: 'SELF_PAY',
    });
    day.items = ['First', 'Second', 'Hidden'].map((name, index) => ({
      id: randomUUID(),
      attractionId: null,
      nameZh: name,
      nameEn: name,
      descriptionZh: `景点${index + 1}描述`,
      descriptionEn: `${name} attraction description.`,
      appears: index !== 2,
      feeState: 'INCLUDED',
    }));
    day.services = [
      {
        id: randomUUID(),
        nameZh: '接待',
        nameEn: 'Reception',
        appears: true,
        feeState: 'INCLUDED',
      },
      {
        id: randomUUID(),
        nameZh: '内部交接',
        nameEn: 'Internal handover',
        appears: false,
        feeState: 'INCLUDED',
      },
      {
        id: randomUUID(),
        nameZh: '送行',
        nameEn: 'Farewell',
        appears: true,
        feeState: 'SELF_PAY',
      },
    ];
    day.guideLanguage = 'English';
    day.eventOrder = [
      day.legs[2].id,
      day.items[1].id,
      day.services[0].id,
      day.services[1].id,
      day.hotels[0].id,
      day.legs[0].id,
      day.meals[0].id,
      day.items[0].id,
    ];
    const before = structuredClone(itinerary);
    const preview = buildWebsitePreview(inquiry, itinerary, config);
    expect(preview.english.itinerary[0]).toMatchObject({
      transportation: 'Flight\nHigh-speed train',
      sightseeing:
        'Second attraction description.\nReception\nFirst attraction description.\nFarewell',
      hotel: 'Kunming',
      meal: 'B',
    });
    expect(preview.chinese.itinerary[0]).toMatchObject({
      transportation: '航班\n高铁',
      sightseeing: '景点2描述\n接待\n景点1描述\n送行',
      hotel: '昆明',
      meal: '早餐',
    });
    for (const output of [preview.english, preview.chinese]) {
      const entry = output.teamStandard?.find(
        ({ category }) => category === 'entry',
      )?.included;
      const transport = output.teamStandard?.find(
        ({ category }) => category === 'transport',
      )?.included;
      expect(entry).toHaveLength(1);
      expect(entry?.[0]).toMatch(/First.*Second.*Hidden/);
      expect(transport).toHaveLength(1);
      expect(transport?.[0]).toMatch(
        output === preview.english ? /Dali.*Kunming/ : /大理.*昆明/,
      );
    }
    expect(preview.english.inclusions).toEqual(
      expect.arrayContaining([
        'D1: Tour guide (English) included.',
        'Hotel Manual Hotel with breakfast included.',
      ]),
    );
    for (const [output, name] of [
      [preview.english, 'Reception'],
      [preview.chinese, '接待'],
    ] as const) {
      expect(output.inclusions.join(' ')).not.toContain(name);
      expect(
        output.teamStandard
          ?.find((row) => row.category === 'service')
          ?.included.join(' '),
      ).not.toContain(name);
    }
    expect(preview.english.itinerary[1]).toMatchObject({
      transportation: '',
      sightseeing: '',
      hotel: '',
      meal: '',
    });
    expect(itinerary).toEqual(before);
    day.services[0].nameEn = '';
    day.services[1].nameZh = '';
    const issues = buildWebsitePreview(inquiry, itinerary, config).issues;
    expect(issues).toContainEqual(
      expect.objectContaining({
        target: { kind: 'event', id: day.services[0].id },
      }),
    );
    expect(
      issues.some(
        (issue) =>
          issue.target?.kind === 'event' &&
          issue.target.id === day.services[1].id,
      ),
    ).toBe(false);
  });

  it('shows breakfast for any included hotel breakfast and lists only included meals in meal order', () => {
    const { config, inquiry, itinerary } = fixture();
    const day = itinerary.days[0];
    day.hotels.push({
      ...day.hotels[0],
      id: randomUUID(),
      tier: 'B',
      breakfastIncluded: false,
    });
    day.meals.unshift({
      ...day.meals[0],
      id: randomUUID(),
      slot: 'breakfast',
      feeState: 'SELF_PAY',
    });
    day.meals[1].feeState = 'INCLUDED';
    const mixed = buildWebsitePreview(inquiry, itinerary, config);
    expect(mixed.english.itinerary[0].meal).toBe('B / L');
    expect(mixed.chinese.itinerary[0].meal).toBe('早餐 / 午餐');
    expect(
      mixed.english.hotelOptions.map((hotel) => hotel.breakfastIncluded),
    ).toEqual([true, false]);
    day.hotels[0].breakfastIncluded = false;
    expect(
      buildWebsitePreview(inquiry, itinerary, config).english.itinerary[0].meal,
    ).toBe('L');
    day.meals[0].feeState = 'INCLUDED';
    day.meals[2].feeState = 'INCLUDED';
    expect(
      buildWebsitePreview(inquiry, itinerary, config).english.itinerary[0].meal,
    ).toBe('B / L / D');
    day.overnightCityId = null;
    day.hotels[0].breakfastIncluded = true;
    day.meals.forEach((meal) => {
      meal.feeState = 'SELF_PAY';
    });
    const noStay = buildWebsitePreview(inquiry, itinerary, config);
    expect(noStay.english.itinerary[0]).toMatchObject({ hotel: '', meal: '' });
    expect(noStay.english.hotelOptions).toEqual([]);
    expect(noStay.english.inclusions.join(' ')).not.toContain('Manual Hotel');
  });

  it('lists hotel breakfast under meals and skips unconfirmed hotel names', () => {
    const { config, inquiry, itinerary } = fixture();
    const day = itinerary.days[0];
    day.hotels.push({
      ...day.hotels[0],
      id: randomUUID(),
      tier: 'B',
      nameEn: '',
      nameZh: '',
    });
    const standard = (category: string) =>
      buildWebsitePreview(
        inquiry,
        itinerary,
        config,
      ).english.teamStandard?.find((row) => row.category === category)
        ?.included;
    expect(standard('hotel')).toEqual(['Manual Hotel included.']);
    expect(standard('meal')).toContain(
      'Hotel Manual Hotel with breakfast included.',
    );
    expect(standard('meal')?.join(' ')).not.toContain('Hotel  with');
  });

  it('freezes concise hotel categories and a separate configured no-shopping statement', () => {
    const { config, inquiry, itinerary } = fixture();
    const day = itinerary.days[0];
    day.hotels = (['A', 'B', 'C', 'D'] as const).map((tier) => ({
      ...day.hotels[0],
      id: randomUUID(),
      tier,
    }));
    itinerary.vehiclePrices = day.hotels.map((hotel) => ({
      ...itinerary.vehiclePrices[0],
      hotelTier: hotel.tier,
    }));
    const preview = buildWebsitePreview(inquiry, itinerary, config);
    expect(
      preview.english.quotation.map((quote) => quote.hotelCategory),
    ).toEqual(['5-star', '4-star', '3-star', '2-star and below']);
    expect(
      preview.chinese.hotelOptions.map((hotel) => hotel.tierLabel),
    ).toEqual(['五星', '四星', '三星', '二星及以下']);
    expect(
      preview.english.hotelOptions.map((hotel) => hotel.tierLabel),
    ).toEqual(['5-star', '4-star', '3-star', '2-star and below']);
    expect(preview.english.notes).toHaveLength(2);
    expect(preview.english.notes).not.toContain('NO SHOPPING.');
    expect(preview.english.noShopping).toBe('NO SHOPPING.');
    expect(preview.chinese.noShopping).toBe('无购物。');
    expect(preview.validationVersion).toBe(7);
  });
});
