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
      otherExpenses: null,
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
  it('preserves guide day price and derives service days from the inquiry', async () => {
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
    const saved = await validator.normalize(manager, input, input, 15);
    expect(saved.guidePlans[0]).toMatchObject({
      dailyPrice: 450,
      serviceDays: 15,
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
            startDate: '2026-09-08',
            endDate: '2026-09-08',
            totalPrice: null,
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
  it('requires vehicle ranges within the inquiry duration without overlaps and sums optional range prices', async () => {
    const input = plan();
    input.dailyPlans.push(
      { ...structuredClone(input.dailyPlans[0]), id: 'b', items: [] },
      { ...structuredClone(input.dailyPlans[0]), id: 'c', items: [] },
    );
    input.vehiclePlans = [
      {
        tier: 'standard',
        totalPrice: null,
        arrangements: [
          {
            id: 'first',
            startDate: '2026-09-08',
            endDate: '2026-09-09',
            totalPrice: 1000,
            vehicles: [
              { vehicleId: 'bus', vehicleName: '', seats: 7, quantity: 1 },
            ],
          },
          {
            id: 'second',
            startDate: '2026-09-09',
            endDate: '2026-09-10',
            totalPrice: 3000,
            vehicles: [
              { vehicleId: 'bus', vehicleName: '', seats: 7, quantity: 1 },
            ],
          },
        ],
      },
    ];
    const manager = {
      findOneBy: jest.fn().mockResolvedValue({
        name: 'Bus',
        seats: 7,
        serviceLevel: 'standard',
        status: 'enabled',
      }),
    } as unknown as EntityManager;

    await expect(
      validator.normalize(manager, input, input),
    ).rejects.toMatchObject({ code: 'ITINERARY_INVALID' });
    input.vehiclePlans[0].arrangements[1].startDate = '2026-09-10';
    const saved = await validator.normalize(manager, input, input);
    expect(saved.vehiclePlans[0].totalPrice).toBe(4000);
    input.vehiclePlans[0].totalPrice = 4500;
    expect(
      (await validator.normalize(manager, input, input)).vehiclePlans[0]
        .totalPrice,
    ).toBe(4500);

    input.vehiclePlans[0].arrangements = [
      {
        ...input.vehiclePlans[0].arrangements[0],
        endDate: '2026-09-11',
      },
    ];
    await expect(
      validator.normalize(manager, input, input),
    ).rejects.toMatchObject({ code: 'ITINERARY_INVALID' });
  });
  it('rejects impossible calendar dates in saves and PDF readiness', async () => {
    const input = plan();
    input.startDate = '2026-02-01';
    input.vehiclePlans = [
      {
        tier: 'standard',
        totalPrice: 1000,
        arrangements: [
          {
            id: 'invalid-date',
            startDate: '2026-02-30',
            endDate: '2026-02-30',
            vehicles: [],
          },
        ],
      },
    ];
    await expect(
      validator.normalize({} as EntityManager, input, input, 40),
    ).rejects.toMatchObject({ code: 'ITINERARY_INVALID' });
    try {
      validator.assertPdfReady(input, 40);
      throw new Error('Expected PDF_NOT_READY');
    } catch (error) {
      expect(
        (error as { details: { issues: string[] } }).details.issues,
      ).toContain('vehicleDays');
      expect(error).toMatchObject({
        code: 'PDF_NOT_READY',
      });
    }
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
