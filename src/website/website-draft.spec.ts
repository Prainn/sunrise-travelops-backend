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
    const query = jest.fn().mockResolvedValue([]);
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
      arrivalTime: '',
      departureTime: '',
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
    jest.spyOn(internal, 'config').mockResolvedValue({
      version: 1,
      cities: [],
      attractions: [],

      routes: [],
      hotels: [],
      patterns: [],
      skeletons: [],
      templates: [],
    });
    const save = jest
      .spyOn(internal, 'savePlan')
      .mockImplementation((_manager, old, input) =>
        Promise.resolve({
          ...old,
          ...input,
        }),
      );
    return { service, plan, save };
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
});
