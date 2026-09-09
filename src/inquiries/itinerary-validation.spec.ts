import 'reflect-metadata';
import type { EntityManager } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { ItineraryInput } from './inquiry.dto';
import { ItineraryValidation } from './itinerary-validation';
function plan() {
  return plainToInstance(ItineraryInput, {
    title: 'Trip',
    startDate: '2026-09-08',
    adults: 2,
    childrenCount: 0,
    leaderCount: 0,
    destinations: ['昆明'],
    dailyPlans: [
      {
        id: 'a',
        dayNumber: 1,
        date: '2026-09-08',
        departure: '',
        destination: '',
        overnightDestination: '',
        meals: { breakfast: false, lunch: true, dinner: false },
        transport: '',
        description: '',
        items: [
          {
            id: 'meal',
            type: 'restaurant',
            mealSlot: 'lunch',
            resourceId: 'restaurant',
            resourcePriceId: 'price',
            resourceName: 'Meal',
            priceName: 'Set',
            quantity: 2,
            unit: 'person',
            unitCost: 50,
            totalCost: 100,
            remark: '',
          },
        ],
      },
    ],
    hotelPlans: [],
    vehiclePlans: [],
    guidePlans: [],
    quote: {
      options: [],
      otherExpenses: 0,
      transportFees: [],
      chineseTip: null,
      englishTip: null,
      customerNotes: '',
      holidayRestrictions: '',
      hotelReplacementTerms: '',
    },
  });
}
describe('resource snapshot validation', () => {
  const validator = new ItineraryValidation();
  it('ignores client price edits to existing meals and recalculates quantity at the saved price', async () => {
    const old = plan();
    const input = plan();
    input.dailyPlans[0].items[0].unitCost = 1;
    input.dailyPlans[0].items[0].quantity = 3;
    const saved = await validator.normalize({} as EntityManager, input, old);
    expect(saved.dailyPlans[0].items[0]).toMatchObject({
      unitCost: 50,
      totalCost: 150,
    });
  });
  it('preserves edited guide day price and day count while resolving service labels from the resource', async () => {
    const input = plan();
    input.guidePlans = [
      {
        destination: '昆明',
        guideId: 'g',
        guideName: 'spoof',
        secondLanguage: 'none',
        shopping: true,
        dailyPrice: 450,
        serviceDays: 7,
      },
    ];
    const manager = {
      findOneBy: jest.fn().mockResolvedValue({
        name: '中文+英文 · 不进店',
        secondLanguage: 'en',
        shopping: false,
        status: 'enabled',
        dailyPrice: '600',
      }),
    } as unknown as EntityManager;
    const saved = await validator.normalize(manager, input, input);
    expect(saved.guidePlans[0]).toMatchObject({
      dailyPrice: 450,
      serviceDays: 7,
      secondLanguage: 'en',
      shopping: false,
    });
  });
  it('validates fleet capacity against tourists plus leaders and reloads authoritative seats', async () => {
    const input = plan();
    input.adults = 60;
    input.leaderCount = 1;
    input.vehiclePlans = [
      {
        tier: 'standard',
        totalPrice: 8000,
        arrangements: [
          {
            id: 'fleet',
            dayIds: ['a'],
            vehicles: [39, 14, 7].map((seats) => ({
              vehicleId: String(seats),
              vehicleName: 'spoof',
              seats: 1000,
              quantity: 1,
            })),
          },
        ],
      },
    ];
    const manager = {
      findOneBy: jest
        .fn()
        .mockImplementation((_entity: unknown, query: { id: string }) =>
          Promise.resolve({
            name: 'Bus',
            seats: Number(query.id),
            serviceLevel: 'standard',
            status: 'enabled',
          }),
        ),
    } as unknown as EntityManager;
    await expect(
      validator.normalize(manager, input, input),
    ).rejects.toMatchObject({ code: 'ITINERARY_INVALID' });
    input.vehiclePlans[0].arrangements[0].vehicles[2].quantity = 2;
    const saved = await validator.normalize(manager, input, input);
    expect(saved.vehiclePlans[0].arrangements[0].vehicles[0].seats).toBe(39);
    expect(saved.vehiclePlans[0].totalPrice).toBe(8000);
  });
  it('preserves actual hotel price when selecting a hotel and when saving the same hotel', async () => {
    const input = plan();
    input.hotelPlans = [
      {
        tier: 'international_five_star',
        hotels: [
          {
            destination: '昆明',
            hotelId: 'h',
            hotelName: 'spoof',
            rating: '',
            breakfast: '',
            unit: '',
            unitCost: 123,
          },
        ],
      },
    ];
    const old = plan();
    const manager = {
      findOneBy: jest.fn().mockResolvedValue({
        name: 'Hotel',
        city: '昆明',
        rating: 'international_five_star',
        breakfast: '',
        unit: 'roomNight',
        status: 'enabled',
        individualPrice: '500',
      }),
    } as unknown as EntityManager;
    const saved = await validator.normalize(manager, input, old);
    expect(saved.hotelPlans[0].hotels[0]).toMatchObject({
      unitCost: 123,
      hotelName: 'Hotel',
    });
    const changed = structuredClone(saved);
    changed.hotelPlans[0].hotels[0].unitCost = 234;
    expect(
      (await validator.normalize(manager, changed, saved)).hotelPlans[0]
        .hotels[0].unitCost,
    ).toBe(234);
  });
  it('keeps draft saves separate from the PDF readiness gate', async () => {
    const input = plan();
    expect(
      await validator.normalize({} as EntityManager, input, input),
    ).toBeDefined();
    expect(() => validator.assertPdfReady(input)).toThrow();
  });
});
