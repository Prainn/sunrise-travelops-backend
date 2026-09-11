import 'reflect-metadata';
import type { DataSource, EntityManager } from 'typeorm';
import { InquiriesService } from './inquiries.service';
import { ItineraryValidation } from './itinerary-validation';
import { ItineraryEntity, ItineraryQuoteEntity } from './inquiry.entity';
import type { AgenciesService } from '../resources/agencies/agencies.service';
import type { ItineraryInput } from './inquiry.dto';
import { createDefaultQuoteSettings } from './quote-pricing';

function setup() {
  const data: ItineraryInput = {
    title: 'Trip',
    startDate: '2026-09-11',
    adults: 8,
    childrenCount: 2,
    leaderCount: 0,
    destinations: ['昆明'],
    dailyPlans: [],
    hotelPlans: [],
    vehiclePlans: [],
    guidePlans: [],
    quote: createDefaultQuoteSettings(),
  };
  const itinerary = {
    id: 'plan',
    inquiryId: 'inquiry',
    data,
    version: 3,
    status: 'draft',
  };
  const inquiry = {
    id: 'inquiry',
    ownerId: 'owner',
    status: 'planning',
    data: { plannedDays: 15 },
  };
  const getOne = jest.fn().mockResolvedValue(inquiry);
  const query = { andWhere: jest.fn().mockReturnThis(), getOne };
  const manager = {
    findOneBy: jest
      .fn()
      .mockImplementation((entity) =>
        entity === ItineraryEntity ? itinerary : null,
      ),
    findOneByOrFail: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(query),
    save: jest.fn(),
  };
  const normalize = jest
    .fn()
    .mockImplementation((_manager: EntityManager, input: ItineraryInput) =>
      Promise.resolve(structuredClone(input)),
    );
  const service = new InquiriesService(
    { manager } as unknown as DataSource,
    { normalize } as unknown as ItineraryValidation,
    {} as AgenciesService,
  );
  const actor = {
    id: 'owner',
    username: 'owner',
    name: 'Owner',
    roles: ['COORDINATOR'],
    admin: false,
    ip: '',
    requestId: '',
  };
  return {
    data,
    itinerary,
    inquiry,
    manager,
    normalize,
    service,
    actor,
    getOne,
  };
}

it('previews normalized unsaved costs without changing the persisted version, data or logs', async () => {
  const t = setup();
  const original = structuredClone(t.itinerary);
  t.normalize.mockImplementation(
    (manager: EntityManager, input: ItineraryInput) => {
      expect(manager).toBe(t.manager);
      input.dailyPlans = [
        {
          id: 'day',
          date: '2026-09-11',
          dayNumber: 1,
          departure: '',
          destination: '',
          overnightDestination: '',
          meals: { breakfast: false, lunch: true, dinner: false },
          transport: '',
          items: [
            {
              id: 'meal',
              type: 'restaurant',
              resourceId: null,
              resourcePriceId: null,
              resourceName: 'Meal',
              priceName: '',
              unit: 'person',
              quantity: 10,
              unitCost: 50,
              totalCost: 500,
              remark: '',
            },
          ],
        },
      ];
      return Promise.resolve(input);
    },
  );
  const result = await t.service.previewQuote(
    'plan',
    structuredClone(t.data),
    t.actor,
  );
  expect(result.dailyResourceCost).toBe(500);
  expect(t.normalize).toHaveBeenCalledWith(
    t.manager,
    expect.anything(),
    t.data,
    15,
  );
  expect(t.itinerary).toEqual(original);
  expect(t.manager.save).not.toHaveBeenCalled();
});

it('returns the frozen quote rather than recalculating a quoted itinerary', async () => {
  const t = setup();
  t.itinerary.status = 'quoted';
  const frozen = { hotelRoomCount: 123, options: [{ totalPrice: 987.65 }] };
  t.manager.findOneByOrFail.mockResolvedValue({
    snapshot: { calculation: frozen },
  });
  expect(await t.service.quoteCalculation('plan', t.actor)).toBe(frozen);
  expect(t.manager.findOneByOrFail).toHaveBeenCalledWith(ItineraryQuoteEntity, {
    itineraryId: 'plan',
  });
  expect(t.normalize).not.toHaveBeenCalled();
});

it('calculates submitted content independently of the saved version', async () => {
  const t = setup();
  const first = await t.service.previewQuote(
    'plan',
    structuredClone(t.data),
    t.actor,
  );
  t.itinerary.version++;
  const second = await t.service.previewQuote(
    'plan',
    structuredClone(t.data),
    t.actor,
  );
  expect(second).toEqual(first);
  expect(t.manager.save).not.toHaveBeenCalled();
});

it.each(['quoted', 'lost', 'archived'])(
  'rejects preview changes for %s state',
  async (status) => {
    const t = setup();
    if (status === 'quoted') t.itinerary.status = status;
    else t.inquiry.status = status;
    await expect(
      t.service.previewQuote('plan', t.data, t.actor),
    ).rejects.toThrow();
    expect(t.normalize).not.toHaveBeenCalled();
  },
);

it('does not expose calculations outside the inquiry owner scope', async () => {
  const t = setup();
  t.getOne.mockResolvedValue(null);
  await expect(t.service.quoteCalculation('plan', t.actor)).rejects.toThrow();
  await expect(
    t.service.previewQuote('plan', t.data, t.actor),
  ).rejects.toThrow();
  expect(t.normalize).not.toHaveBeenCalled();
});
