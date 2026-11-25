import { DataSource, EntityManager } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { WebsiteService } from './website.service';
import { WEBSITE_PRICE_CATEGORIES } from './website-price';
import { WebsiteUpdateItineraryDto } from './website.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  WebsiteConfig,
  WebsiteInquiry,
  WebsiteItinerary,
  WebsiteItineraryInput,
} from './website.types';

// Persistence/DTO roundtrips are exercised against PostgreSQL in website-sequence.integration-check.
/** Five-part price carrying the whole total on the hotel component. */
const hotelOnlyComponents = (unitPrice: string) =>
  WEBSITE_PRICE_CATEGORIES.map((category) => ({
    category,
    unitPrice: category === 'hotel' ? unitPrice : '0',
    showInPdf: false,
  }));

describe('website draft save and explicit validation', () => {
  const user = {
    scope: 'website',
    permissions: ['website:itinerary:update'],
  } as AuthenticatedUser;
  function setup(
    destinations: string[] = [],
    businessUnit: WebsiteInquiry['businessUnit'] = 'website',
  ) {
    const query = jest
      .fn<Promise<unknown[]>, [sql: string, parameters?: unknown[]]>()
      .mockResolvedValue([]);
    const manager = { query } as unknown as EntityManager;
    const transaction = jest.fn((fn: (manager: EntityManager) => unknown) =>
      fn(manager),
    );
    const service = new WebsiteService({
      manager,
      transaction,
    } as unknown as DataSource);
    const internal = service as unknown as {
      itinerary: () => Promise<{
        inquiry: WebsiteInquiry;
        itinerary: WebsiteItinerary;
      }>;
      mutable: () => Promise<void>;
      config: () => Promise<WebsiteConfig>;
      savePlan: (
        manager: EntityManager,
        old: WebsiteItinerary,
        input: WebsiteItineraryInput,
      ) => Promise<WebsiteItinerary>;
    };
    const plan: WebsiteItinerary & WebsiteUpdateItineraryDto = {
      businessUnit: 'website',
      inquiryId: 'inquiry',
      code: 'WIT-TEST',
      createdAt: '',
      updatedAt: '',
      id: 'plan',
      version: 3,
      status: 'draft',
      title: '',
      duration: 1,
      startDate: null,
      pax: null,
      configVersion: 1,

      vehiclePrices: [],
      hotelPricingMode: 'tiered',
      nightlyShowHotelPrice: false,
      nightlyVehiclePrices: [],
      days: [
        {
          id: 'day',
          dayNumber: 1,
          departCityId: '',
          endCityId: '',
          overnightCityId: null,
          guideLanguage: '',
          items: [],
          legs: [],
          meals: [],
          hotels: [],
          services: [],
          eventOrder: [],
        },
      ],
      deletedDays: [],
      reorderDraft: {
        removedItemIds: [],
        transportCopies: [],
        dayIds: ['day'],
        addedDayIds: [],
        deletedDays: [],
        placements: [{ dayId: 'day', itemIds: ['copy'] }],
        copies: [
          {
            id: 'copy',
            sourceId: 'item',
            parentId: 'item',
            dayId: 'day',
            placed: false,
          },
        ],
        overnight: [],
      },
    };
    jest.spyOn(internal, 'itinerary').mockImplementation(() =>
      Promise.resolve({
        inquiry: {
          canDelete: false,
          businessUnit,
          destinations,
          version: 1,
          startDate: null,
          id: 'inquiry',
          code: 'WIQ-TEST',
          hasActiveTour: false,
          countryItemId: 'country',
          countryCode: 'CHN',
          countryOrRegion: '中国',
          ownerId: 'owner',
          owner: 'Owner',
          customerName: 'Customer',
          plannedDays: 1,
          requirements: 'Test',
          contactInfo: '',
          receivedAt: null,
          contactChannel: '',
          whatsappSourceId: '',
          websiteInquiryNo: '',
          landingPage: '',
          acquisitionSource: '',
          pax: null,
          internalRemark: '',
          lostReason: '',
          status: 'planning',
          createdAt: '',
          updatedAt: '',
        },
        itinerary: plan,
      }),
    );
    jest.spyOn(internal, 'mutable').mockResolvedValue();
    const config: WebsiteConfig = {
      version: 1,
      cities: [],
      attractions: [],

      routes: [],
      hotels: [],
      patterns: [],
      skeletons: [],
      templates: [],
    };
    jest.spyOn(internal, 'config').mockResolvedValue(config);
    const save = jest
      .spyOn(internal, 'savePlan')
      .mockImplementation((_manager, old, input) =>
        Promise.resolve({
          ...old,
          ...input,
          vehiclePrices: input.vehiclePrices.map((price) => ({
            ...price,
            includesDriver: false,
            includesGuide: false,
          })),
        }),
      );
    return { service, plan, save, config, query };
  }
  it('saves distinct vehicle codes and their respective prices without rewriting them', async () => {
    const { service, plan, save } = setup();
    const codes = ['seat13', '13_seat', '13座', '38'];
    plan.days[0].legs = codes.map((vehicleType, i) => ({
      id: 'leg-' + i,
      distanceKm: null,
      durationMinutes: null,
      showInMileage: false,
      routeId: null,
      fromCityId: '',
      toCityId: '',
      mode: 'private_vehicle',
      vehicleType,
      nameZh: '专车',
      nameEn: 'Private vehicle',
      feeState: 'INCLUDED',
    }));
    plan.vehiclePrices = codes.map((vehicleType, i) => ({
      vehicleType,
      hotelTier: null,
      unitPrice: String(100 + i),
      priceComponents: hotelOnlyComponents(String(100 + i)),
      includesDriver: true,
      includesGuide: false,
    }));
    await service.saveItinerary(plan.id, plan, user);
    const saved = save.mock.calls[0][2];
    expect(saved.days[0].legs.map((leg) => leg.vehicleType)).toEqual(codes);
    expect(
      saved.vehiclePrices.map((price) => [
        price.vehicleType,
        Number(price.unitPrice),
      ]),
    ).toEqual(codes.map((code, i) => [code, 100 + i]));
  });
  it('keeps omitted remarks with their day across recycling and restoration, and accepts an explicit clear', async () => {
    const { service, plan } = setup();
    const original = plan.days[0];
    const recycled = { ...original, id: 'recycled' };
    plan.days = [{ ...original, internalRemark: '原日备注' }];
    plan.deletedDays = [
      { originalDate: null, day: { ...recycled, internalRemark: '恢复备注' } },
    ];
    const update = {
      ...plan,
      days: [recycled],
      deletedDays: [{ originalDate: null, day: original }],
    };
    const saved = await service.saveItinerary(plan.id, update, user);
    expect(saved.days[0].internalRemark).toBe('恢复备注');
    expect(saved.deletedDays?.[0].day.internalRemark).toBe('原日备注');
    const preview = await service.validateItinerary(plan.id, update, user);
    expect(JSON.stringify(preview)).not.toMatch(
      /internalRemark|恢复备注|原日备注/,
    );
    update.days[0].internalRemark = '';
    const cleared = await service.saveItinerary(plan.id, update, user);
    expect(cleared.days[0].internalRemark).toBe('');
  });

  it('limits nonempty day remarks to website inquiries', async () => {
    const { service, plan } = setup([], 'linxi');
    plan.days[0].internalRemark = '内部标记';
    await expect(service.saveItinerary(plan.id, plan, user)).rejects.toThrow(
      '行程日内部备注仅适用于独立站询盘',
    );
  });
  it.each(['isAirportPickup', 'isAirportDropoff'] as const)(
    'validates uniqueness, service-day boundary and business scope for %s',
    async (role) => {
      const { service, plan, save } = setup();
      const leg = {
        id: 'leg',
        routeId: null,
        fromCityId: '',
        toCityId: '',
        mode: 'other' as const,
        nameZh: '',
        nameEn: '',
        feeState: 'SELF_PAY' as const,
        [role]: true,
        distanceKm: null,
        vehicleType: null,
        durationMinutes: null,
        showInMileage: false,
      };
      plan.days[0].legs = [leg, { ...leg, id: 'other' }];
      await expect(service.saveItinerary(plan.id, plan, user)).rejects.toThrow(
        '最多可选一个',
      );
      plan.days[0].legs = [leg];
      plan.days.push({
        ...plan.days[0],
        id: 'another-day',
        dayNumber: 2,
        legs: [],
      });
      if (role === 'isAirportPickup') {
        plan.days[1].legs = [leg];
        plan.days[0].legs = [];
      }
      await expect(service.saveItinerary(plan.id, plan, user)).rejects.toThrow(
        role === 'isAirportPickup' ? '首日' : '末日',
      );
      expect(save).not.toHaveBeenCalled();
      const linxi = setup([], 'linxi');
      linxi.plan.days[0].legs = [leg];
      await expect(
        linxi.service.saveItinerary(linxi.plan.id, linxi.plan, user),
      ).rejects.toThrow('仅适用于独立站');
    },
  );
  it('saves an unfinished board and blank title/cities, but validates them on demand without writing', async () => {
    const { service, plan, save } = setup();
    const saved = await service.saveItinerary(plan.id, plan, user);
    expect(saved.reorderDraft).toEqual(plan.reorderDraft);
    expect(saved.days[0].departCityId).toBe('');
    expect(save).toHaveBeenCalledTimes(1);
    save.mockClear();
    const preview = await service.validateItinerary(plan.id, plan, user);
    expect(
      preview.issues.some((issue) => issue.code === 'REORDER_PENDING'),
    ).toBe(true);
    expect(
      preview.issues.some((issue) => issue.code === 'ITINERARY_INVALID'),
    ).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
  it('returns one actionable preview issue per leg with stale route cities', async () => {
    const { service, plan, config, save } = setup();
    config.cities = ['kunming', 'dali', 'lijiang'].map((id) => ({
      id,
      nameZh: id,
      nameEn: id,
      resourceId: null,
      status: 'enabled',
    }));
    config.routes = [
      {
        id: 'old-route',
        fromCityId: 'dali',
        toCityId: 'lijiang',
        nameZh: '大理 → 丽江',
        nameEn: 'Dali → Lijiang',
        mode: 'private_vehicle',
        status: 'enabled',
        feeState: 'INCLUDED',
        vehicleOptions: [],
      },
      {
        id: 'rail-route',
        fromCityId: 'kunming',
        toCityId: 'dali',
        nameZh: '昆明 → 大理',
        nameEn: 'Kunming → Dali',
        mode: 'hsr',
        status: 'enabled',
        feeState: 'INCLUDED',
      },
    ];
    plan.duration = 3;
    plan.reorderDraft = null;
    const blankDay = plan.days[0];
    plan.days = [1, 2, 3].map((dayNumber) => ({
      ...blankDay,
      id: `day-${dayNumber}`,
      dayNumber,
      departCityId: 'kunming',
      endCityId: 'dali',
    }));
    const day = plan.days[2];
    day.legs = ['first-leg', 'second-leg'].map((id) => ({
      id,
      routeId: 'old-route',
      fromCityId: 'kunming',
      toCityId: 'dali',
      mode: 'hsr',
      nameZh: '昆明 → 大理',
      nameEn: 'Kunming → Dali',
      feeState: 'INCLUDED',
      vehicleType: null,
      distanceKm: null,
      durationMinutes: null,
      showInMileage: false,
    }));
    const message = '交通段城市与所选路线不一致';
    const expected = day.legs.map(({ id }) => ({
      code: 'ITINERARY_INVALID',
      severity: 'ERROR',
      message,
      dayNumber: 3,
      target: { kind: 'event', id },
    }));
    const preview = await service.preview(plan.id, user);
    const validation = await service.validateItinerary(plan.id, plan, user);
    for (const result of [preview, validation])
      expect(
        result.issues.filter((issue) => issue.message === message),
      ).toEqual(expected);

    day.legs[0].routeId = 'rail-route';
    day.legs[1].routeId = null;
    const repaired = await service.preview(plan.id, user);
    expect(repaired.issues.some((issue) => issue.message === message)).toBe(
      false,
    );
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects old page payloads only after nightly pricing has been configured', async () => {
    const { service, plan, save } = setup();
    const legacy = plainToInstance(WebsiteUpdateItineraryDto, {
      ...plan,
      hotelPricingMode: undefined,
      nightlyShowHotelPrice: undefined,
      nightlyVehiclePrices: undefined,
    });
    await service.saveItinerary(plan.id, legacy, user);
    expect(save).toHaveBeenCalledTimes(1);
    save.mockClear();

    plan.nightlyShowHotelPrice = true;
    for (const action of ['saveItinerary', 'validateItinerary'] as const) {
      await expect(
        service[action](plan.id, legacy, user),
      ).rejects.toMatchObject({
        code: 'ITINERARY_VERSION_CONFLICT',
      });
    }
    expect(save).not.toHaveBeenCalled();
    await service.saveItinerary(plan.id, plan, user);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('keeps version, readonly and permission guards for both save and validation', async () => {
    const { service, plan, save } = setup();
    for (const action of ['saveItinerary', 'validateItinerary'] as const) {
      await expect(
        service[action](plan.id, { ...plan, version: 2 }, user),
      ).rejects.toMatchObject({ code: 'ITINERARY_VERSION_CONFLICT' });
      plan.status = 'quoted';
      await expect(service[action](plan.id, plan, user)).rejects.toMatchObject({
        code: 'ITINERARY_READ_ONLY',
      });
      plan.status = 'draft';
      await expect(
        service[action](plan.id, plan, { ...user, permissions: [] }),
      ).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    }
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps saved route cities and restricts newly chosen day and transport cities', async () => {
    const { service, plan, save } = setup(['dali', 'lijiang']);
    plan.days[0].departCityId = 'deqin';
    const edited = structuredClone(plan);
    edited.days[0].endCityId = 'lijiang';
    const saved = await service.saveItinerary(plan.id, edited, user);
    expect(saved.days[0]).toMatchObject({
      departCityId: 'deqin',
      endCityId: 'lijiang',
    });

    edited.days[0].legs.push({
      id: 'leg',
      routeId: null,
      fromCityId: 'deqin',
      toCityId: 'nujiang',
      mode: 'other',
      nameZh: '交通',
      nameEn: 'Transport',
      feeState: 'INCLUDED',
    });
    for (const action of ['saveItinerary', 'validateItinerary'] as const) {
      await expect(
        service[action](plan.id, edited, user),
      ).rejects.toMatchObject({
        code: 'ITINERARY_INVALID',
        details: { cityId: 'nujiang', dayNumber: 1 },
      });
    }
    edited.days[0].legs = [];
    edited.days[0].endCityId = 'nujiang';
    await expect(
      service.saveItinerary(plan.id, edited, user),
    ).rejects.toMatchObject({
      code: 'ITINERARY_INVALID',
      details: { cityId: 'nujiang', dayNumber: 1 },
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('checks newly generated skeleton cities against the inquiry scope', async () => {
    const { service, plan, config, save } = setup(['dali']);
    config.cities = [
      {
        id: 'deqin',
        nameZh: '德钦',
        nameEn: 'Deqin',
        status: 'enabled',
        resourceId: null,
      },
    ];
    config.skeletons = [
      {
        id: 'skeleton',
        nameZh: '德钦',
        nameEn: 'Deqin',
        status: 'enabled',
        days: [{ cityId: 'deqin', patternId: null }],
      },
    ];
    await expect(
      service.generate(plan.id, plan.version, 'skeleton', user),
    ).rejects.toMatchObject({
      code: 'ITINERARY_INVALID',
      details: { cityId: 'deqin', dayNumber: 1 },
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('checks new stops against the inquiry, config and day endpoints even for draft saves', async () => {
    const { service, plan, config } = setup(['origin', 'stop', 'disabled']);
    config.cities = ['origin', 'stop', 'disabled', 'outside'].map((id) => ({
      id,
      nameZh: id,
      nameEn: id,
      resourceId: null,
      status: id === 'disabled' ? 'disabled' : 'enabled',
    }));
    const edited = structuredClone(plan);
    edited.days[0].departCityId = 'origin';
    for (const cityId of ['origin', 'disabled', 'outside', 'unknown']) {
      edited.days[0].viaCityIds = [cityId];
      for (const action of ['saveItinerary', 'validateItinerary'] as const)
        await expect(
          service[action](plan.id, edited, user),
        ).rejects.toMatchObject({
          code: 'ITINERARY_INVALID',
          details: { cityId, dayNumber: 1 },
        });
    }
    // An already saved stop still belongs to the same day after narrowing the inquiry.
    plan.days[0].viaCityIds = ['outside'];
    edited.days[0].viaCityIds = undefined;
    const saved = await service.saveItinerary(plan.id, edited, user);
    expect(saved.days[0].viaCityIds).toEqual(['outside']);
    edited.days[0].viaCityIds = [];
    expect(
      (await service.saveItinerary(plan.id, edited, user)).days[0].viaCityIds,
    ).toEqual([]);

    const linxi = setup([], 'linxi');
    linxi.plan.days[0].viaCityIds = ['stop'];
    await expect(
      linxi.service.saveItinerary(linxi.plan.id, linxi.plan, user),
    ).rejects.toThrow('途经地仅适用于独立站询盘');
  });

  it('validates and freezes a hotel-free overnight itinerary while preserving other quotation guards', async () => {
    const { service, plan, config, query } = setup(['other-city']);
    plan.title = 'No hotels';
    plan.pax = 3;
    plan.reorderDraft = null;
    Object.assign(plan.days[0], {
      departCityId: 'city',
      endCityId: 'city',
      overnightCityId: 'city',
    });
    plan.vehiclePrices = [
      {
        vehicleType: null,
        hotelTier: null,
        unitPrice: '500.00',
        priceComponents: hotelOnlyComponents('500.00'),
        includesDriver: false,
        includesGuide: false,
      },
    ];
    config.cities = [
      {
        id: 'city',
        nameZh: '昆明',
        nameEn: 'Kunming',
        status: 'enabled',
        resourceId: null,
      },
    ];
    config.templates = [
      'optional-not-included',
      'peak-season',
      'hotel-substitution',
      'no-shopping',
    ].map((code) => ({
      id: code,
      code,
      name: code,
      zh: '说明',
      en: 'Note',
      status: 'enabled',
    }));
    const frozen = jest
      .spyOn(service as unknown as { frozen: () => Promise<unknown> }, 'frozen')
      .mockResolvedValue(null);
    jest
      .spyOn(service as unknown as { log: () => Promise<void> }, 'log')
      .mockResolvedValue();
    query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('next_business_code') ? [{ code: 'WQT-TEST' }] : [],
      ),
    );
    const preview = await service.validateItinerary(plan.id, plan, user);
    expect(preview.issues).toEqual([]);
    const confirmUser = {
      ...user,
      permissions: ['website:itinerary:confirm'],
    };
    const input = {
      version: plan.version,
      inquiryVersion: 1,
      acknowledgedWarnings: [],
    };
    plan.vehiclePrices[0].vehicleType = '23_seat';
    const invalidPrice = await service.validateItinerary(plan.id, plan, user);
    expect(invalidPrice.issues).toEqual([
      expect.objectContaining({
        code: 'VAL-E09',
        severity: 'ERROR',
        target: { kind: 'prices' },
      }),
    ]);
    await expect(
      service.confirm(plan.id, input, confirmUser),
    ).rejects.toMatchObject({
      code: 'PDF_NOT_READY',
      details: { issues: invalidPrice.issues },
    });
    plan.vehiclePrices[0].vehicleType = null;
    plan.pax = null;
    await expect(
      service.confirm(plan.id, input, confirmUser),
    ).rejects.toMatchObject({
      code: 'PDF_NOT_READY',
    });
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO website_quotations'),
      ),
    ).toBe(false);
    plan.pax = 3;
    const quotation = await service.confirm(plan.id, input, confirmUser);
    expect(quotation.english.quotation[0]).toMatchObject({
      hotelTier: null,
      totalPrice: '1500.00',
    });
    const insert = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO website_quotations'),
    );
    expect(JSON.parse(String(insert?.[1]?.[3])) as unknown).toMatchObject({
      validationVersion: 7,
      english: { hotelOptions: [] },
      chinese: { hotelOptions: [] },
    });
    frozen.mockResolvedValue(quotation);
    plan.status = 'quoted';
    config.cities = [];
    expect(await service.preview(plan.id, user)).toBe(quotation);
  });
});
