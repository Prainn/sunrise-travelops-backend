import { DataSource, EntityManager } from 'typeorm';
import { WebsiteService } from './website.service';
import type { WebsiteUpdateItineraryDto } from './website.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  WebsiteConfig,
  WebsiteInquiry,
  WebsiteItinerary,
  WebsiteItineraryInput,
} from './website.types';

// Persistence/DTO roundtrips are exercised against PostgreSQL in website-sequence.integration-check.
describe('website draft save and explicit validation', () => {
  const user = {
    scope: 'website',
    permissions: ['website:itinerary:update'],
  } as AuthenticatedUser;
  function setup() {
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
          businessUnit: 'website',
          destinations: [],
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

  it('validates and freezes a hotel-free overnight itinerary while preserving other quotation guards', async () => {
    const { service, plan, config, query } = setup();
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
        priceComponents: [],
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
      validationVersion: 6,
      english: { hotelOptions: [] },
      chinese: { hotelOptions: [] },
    });
    frozen.mockResolvedValue(quotation);
    plan.status = 'quoted';
    config.cities = [];
    expect(await service.preview(plan.id, user)).toBe(quotation);
  });
});
