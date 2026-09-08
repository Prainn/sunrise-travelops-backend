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
  it('rejects overlapping guide service dates before loading new guide records', async () => {
    const input = plan();
    input.destinations.push('大理');
    input.guidePlans = [
      {
        destination: '昆明',
        guideId: 'g',
        guideName: 'Guide',
        dailyPrice: 20,
        dayIds: ['a'],
      },
      {
        destination: '大理',
        guideId: 'g',
        guideName: 'Guide',
        dailyPrice: 20,
        dayIds: ['a'],
      },
    ];
    await expect(
      validator.normalize({} as EntityManager, input, input),
    ).rejects.toMatchObject({ code: 'ITINERARY_INVALID' });
  });
  it('keeps draft saves separate from the PDF readiness gate', async () => {
    const input = plan();
    expect(
      await validator.normalize({} as EntityManager, input, input),
    ).toBeDefined();
    expect(() => validator.assertPdfReady(input)).toThrow();
  });
});
