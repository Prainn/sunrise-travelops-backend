import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ItineraryInput } from './inquiry.dto';

function request() {
  return {
    title: 'Three hotel tiers',
    startDate: '2026-10-14',
    paxTiers: [10],
    childRate: 70,
    childWithoutBedRate: 50,
    destinations: ['昆明'],
    dailyPlans: [
      {
        id: 'day-1',
        dayNumber: 1,
        date: '2026-10-14',
        departure: '',
        destination: '昆明',
        overnightDestination: '',
        meals: { breakfast: false, lunch: false, dinner: false },
        transport: '',
        description: '',
        items: [],
      },
    ],
    hotelPlans: [3, 4, 5].map((tier) => ({ tier, hotels: [] })),
    vehiclePlans: ['standard', 'vip'].map((tier) => ({
      tier,
      arrangements: [],
      totalPrice: null,
    })),
    guidePlans: [],
    quote: {
      staffRoomCosts: [],
      options: [3, 4, 5].flatMap((hotelTier) =>
        ['standard', 'vip'].map((vehicleTier) => ({
          id: `${hotelTier}-${vehicleTier}`,
          hotelTier,
          vehicleTier,
          paxPrices: [],
        })),
      ),
      transportFees: [],
      customerNotes: '',
      holidayRestrictions: '',
      hotelReplacementTerms: '',
    },
  };
}

describe('itinerary request cardinality', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const metadata = { type: 'body' as const, metatype: ItineraryInput };

  it('accepts three diamond hotel tiers and all six hotel/vehicle combinations', async () => {
    const result = (await pipe.transform(
      request(),
      metadata,
    )) as ItineraryInput;
    expect(result.hotelPlans.map((plan) => plan.tier)).toEqual([3, 4, 5]);
    expect(result.quote.options).toHaveLength(6);
  });

  it.each(['hotelPlans', 'options'] as const)(
    'rejects an extra %s entry',
    async (field) => {
      const body = request();
      if (field === 'hotelPlans') body.hotelPlans.push(body.hotelPlans[0]);
      else body.quote.options.push({ ...body.quote.options[0], id: 'extra' });
      await expect(pipe.transform(body, metadata)).rejects.toThrow(
        BadRequestException,
      );
    },
  );
});
