import type {
  ItineraryDayRecord,
  ItineraryGuidePlan,
  ItineraryHotelPlan,
  ItineraryHotelSelection,
  ItineraryPaxOtherCost,
  ItineraryQuoteSettings,
  ItineraryResourceItem,
  ItineraryVehiclePlan,
} from './itinerary.types';
import { calculateItineraryQuote } from './quote-pricing';

type QuoteInput = Parameters<typeof calculateItineraryQuote>[0];
type QuoteFixture = Pick<
  QuoteInput,
  'paxTiers' | 'childRate' | 'childWithoutBedRate'
> & {
  guidePlans: Pick<ItineraryGuidePlan, 'dailyPrice' | 'serviceDays'>[];
  dailyPlans: (Pick<
    ItineraryDayRecord,
    'dayNumber' | 'overnightDestination'
  > & {
    items: Pick<
      ItineraryResourceItem,
      'type' | 'resourceName' | 'unit' | 'unitCost' | 'quantity' | 'dinerCount'
    >[];
  })[];
  hotelPlans: (Pick<ItineraryHotelPlan, 'tier'> & {
    hotels: Pick<ItineraryHotelSelection, 'destination' | 'unitCost'>[];
  })[];
  vehiclePlans: Pick<ItineraryVehiclePlan, 'tier' | 'totalPrice'>[];
  quote: Pick<
    ItineraryQuoteSettings,
    | 'options'
    | 'staffRoomCosts'
    | 'mealOtherCost'
    | 'attractionOtherCost'
    | 'chineseTip'
    | 'englishTip'
  > & {
    paxOtherCosts: Pick<
      ItineraryPaxOtherCost,
      'pax' | 'guideOtherCost' | 'staffRoomOtherCost'
    >[];
  };
};

function quoteInput(
  overrides: Omit<Partial<QuoteFixture>, 'quote'> & {
    quote?: Partial<QuoteFixture['quote']>;
  } = {},
): QuoteInput {
  const fixture: QuoteFixture = {
    paxTiers: [2],
    childRate: 80,
    childWithoutBedRate: 60,
    hotelPlans: [],
    vehiclePlans: [],
    dailyPlans: [],
    guidePlans: [],
    ...overrides,
    quote: {
      mealOtherCost: null,
      attractionOtherCost: null,
      staffRoomCosts: [],
      paxOtherCosts: [],
      chineseTip: null,
      englishTip: null,
      options: [
        {
          id: 'preferred-standard',
          hotelTier: 'preferred_non_five_star',
          vehicleTier: 'standard',
          paxPrices: [],
        },
      ],
      ...overrides.quote,
    },
  };
  // Pricing only reads these fields; omit identity and resource snapshot data.
  return fixture as QuoteInput;
}

describe('calculateItineraryQuote', () => {
  it('sums guide services, meals and attractions and defaults the adult price to cost', () => {
    const result = calculateItineraryQuote(
      quoteInput({
        guidePlans: [
          { dailyPrice: 10.01, serviceDays: 2 },
          { dailyPrice: 5.02, serviceDays: 1 },
        ],
        dailyPlans: [
          {
            dayNumber: 1,
            overnightDestination: null,
            items: [
              {
                type: 'restaurant',
                resourceName: 'Lunch',
                unit: 'person',
                unitCost: 12.34,
                quantity: 1,
                dinerCount: null,
              },
              {
                type: 'attraction',
                resourceName: 'Museum',
                unit: 'person',
                unitCost: 7.89,
                quantity: 1,
                dinerCount: null,
              },
            ],
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      guideCost: 25.04,
      mealCost: 12.34,
      attractionCost: 7.89,
      dailyResourceCost: 20.23,
      mealDetails: [
        {
          dayNumber: 1,
          resourceName: 'Lunch',
          unitCost: 12.34,
          quantity: 1,
          totalCost: 12.34,
        },
      ],
      attractionDetails: [
        {
          dayNumber: 1,
          resourceName: 'Museum',
          unitCost: 7.89,
          quantity: 1,
          totalCost: 7.89,
        },
      ],
    });
    expect(result.options[0].paxPrices).toMatchObject([
      {
        pax: 2,
        guideServiceUnitCost: 12.52,
        baseCostPerPerson: 32.75,
        adultUnitPrice: 32.75,
        profitPerPerson: 0,
        actualMarginRate: 0,
      },
    ]);
  });

  it('prices all four hotel and vehicle tier combinations using the matching plans', () => {
    const result = calculateItineraryQuote(
      quoteInput({
        hotelPlans: [
          {
            tier: 'preferred_non_five_star',
            hotels: [{ destination: 'Kunming', unitCost: 100 }],
          },
          {
            tier: 'international_five_star',
            hotels: [{ destination: 'Kunming', unitCost: 200 }],
          },
        ],
        vehiclePlans: [
          { tier: 'standard', totalPrice: 60 },
          { tier: 'vip', totalPrice: 100 },
        ],
        dailyPlans: [
          { dayNumber: 1, overnightDestination: 'Kunming', items: [] },
          { dayNumber: 2, overnightDestination: 'Kunming', items: [] },
        ],
        quote: {
          options: [
            {
              id: 'preferred-standard',
              hotelTier: 'preferred_non_five_star',
              vehicleTier: 'standard',
              paxPrices: [],
            },
            {
              id: 'preferred-vip',
              hotelTier: 'preferred_non_five_star',
              vehicleTier: 'vip',
              paxPrices: [],
            },
            {
              id: 'five-star-standard',
              hotelTier: 'international_five_star',
              vehicleTier: 'standard',
              paxPrices: [],
            },
            {
              id: 'five-star-vip',
              hotelTier: 'international_five_star',
              vehicleTier: 'vip',
              paxPrices: [],
            },
          ],
        },
      }),
    );

    expect(result.options).toMatchObject([
      {
        optionId: 'preferred-standard',
        hotelUnitCost: 100,
        vehicleTotal: 60,
        hotelCityCosts: [
          { destination: 'Kunming', nights: 2, unitCost: 100, totalCost: 100 },
        ],
        paxPrices: [{ baseCostPerPerson: 130, singleSupplementUnitCost: 100 }],
      },
      {
        optionId: 'preferred-vip',
        hotelUnitCost: 100,
        vehicleTotal: 100,
        paxPrices: [{ baseCostPerPerson: 150, singleSupplementUnitCost: 100 }],
      },
      {
        optionId: 'five-star-standard',
        hotelUnitCost: 200,
        vehicleTotal: 60,
        hotelCityCosts: [
          { destination: 'Kunming', nights: 2, unitCost: 200, totalCost: 200 },
        ],
        paxPrices: [{ baseCostPerPerson: 230, singleSupplementUnitCost: 200 }],
      },
      {
        optionId: 'five-star-vip',
        hotelUnitCost: 200,
        vehicleTotal: 100,
        paxPrices: [{ baseCostPerPerson: 250, singleSupplementUnitCost: 200 }],
      },
    ]);
  });

  it('rounds each vehicle, guide and staff room share before summing the PAX cost', () => {
    const result = calculateItineraryQuote(
      quoteInput({
        paxTiers: [3, 6],
        vehiclePlans: [{ tier: 'standard', totalPrice: 100.01 }],
        guidePlans: [{ dailyPrice: 50.02, serviceDays: 2 }],
        quote: {
          staffRoomCosts: [
            { destination: 'Kunming', total: 20.01 },
            { destination: 'Dali', total: 10 },
          ],
        },
      }),
    );

    expect(result.guideCost).toBe(100.04);
    expect(result.options[0]).toMatchObject({
      vehicleTotal: 100.01,
      staffRoomTotal: 30.01,
      paxPrices: [
        {
          pax: 3,
          vehicleUnitCost: 33.34,
          guideServiceUnitCost: 33.35,
          staffRoomUnitCost: 10,
          baseCostPerPerson: 76.69,
          adultUnitPrice: 76.69,
        },
        {
          pax: 6,
          vehicleUnitCost: 16.67,
          guideServiceUnitCost: 16.67,
          staffRoomUnitCost: 5,
          baseCostPerPerson: 38.34,
          adultUnitPrice: 38.34,
        },
      ],
    });
  });

  it('adds shared meal and attraction costs to every PAX and other staff costs only to their PAX', () => {
    const result = calculateItineraryQuote(
      quoteInput({
        paxTiers: [2, 4],
        guidePlans: [{ dailyPrice: 100, serviceDays: 1 }],
        quote: {
          mealOtherCost: 1.2,
          attractionOtherCost: 2.3,
          staffRoomCosts: [{ destination: 'Kunming', total: 40 }],
          paxOtherCosts: [{ pax: 2, guideOtherCost: 3, staffRoomOtherCost: 4 }],
        },
      }),
    );

    expect(result).toMatchObject({
      mealCost: 1.2,
      attractionCost: 2.3,
      dailyResourceCost: 3.5,
    });
    expect(result.options[0].paxPrices).toMatchObject([
      {
        pax: 2,
        guideServiceUnitCost: 53,
        staffRoomUnitCost: 24,
        baseCostPerPerson: 80.5,
      },
      {
        pax: 4,
        guideServiceUnitCost: 25,
        staffRoomUnitCost: 10,
        baseCostPerPerson: 38.5,
      },
    ]);
  });

  it.each([
    {
      adultUnitPrice: 100.01,
      childRate: 80,
      childWithoutBedRate: 60,
      childUnitPrice: 80.01,
      childWithoutBedUnitPrice: 60.01,
    },
    {
      adultUnitPrice: 123.45,
      childRate: 85.5,
      childWithoutBedRate: 62.25,
      childUnitPrice: 105.55,
      childWithoutBedUnitPrice: 76.85,
    },
  ])(
    'rounds independent child rates $childRate% and $childWithoutBedRate% from the adult price',
    ({
      adultUnitPrice,
      childRate,
      childWithoutBedRate,
      childUnitPrice,
      childWithoutBedUnitPrice,
    }) => {
      const result = calculateItineraryQuote(
        quoteInput({
          childRate,
          childWithoutBedRate,
          quote: {
            options: [
              {
                id: 'preferred-standard',
                hotelTier: 'preferred_non_five_star',
                vehicleTier: 'standard',
                paxPrices: [{ pax: 2, adultUnitPrice }],
              },
            ],
          },
        }),
      );

      expect(result.options[0].paxPrices[0]).toMatchObject({
        adultUnitPrice,
        childUnitPrice,
        childWithoutBedUnitPrice,
      });
    },
  );

  it.each([
    {
      scenario: 'adult fare only',
      adultUnitPrice: 120,
      chineseTip: null,
      englishTip: null,
      profitPerPerson: 30,
      actualMarginRate: 25,
    },
    {
      scenario: 'Chinese tip included in revenue',
      adultUnitPrice: 100,
      chineseTip: 20,
      englishTip: null,
      profitPerPerson: 30,
      actualMarginRate: 25,
    },
    {
      scenario: 'second-language tip included in revenue',
      adultUnitPrice: 100,
      chineseTip: null,
      englishTip: 10,
      profitPerPerson: 20,
      actualMarginRate: 18.18181818,
    },
    {
      scenario: 'a fare below cost',
      adultUnitPrice: 80,
      chineseTip: 0,
      englishTip: null,
      profitPerPerson: -10,
      actualMarginRate: -12.5,
    },
    {
      scenario: 'zero revenue',
      adultUnitPrice: 0,
      chineseTip: null,
      englishTip: null,
      profitPerPerson: -90,
      actualMarginRate: null,
    },
  ])(
    'calculates profit and sales margin for $scenario',
    ({
      adultUnitPrice,
      chineseTip,
      englishTip,
      profitPerPerson,
      actualMarginRate,
    }) => {
      const result = calculateItineraryQuote(
        quoteInput({
          guidePlans: [{ dailyPrice: 90, serviceDays: 2 }],
          quote: {
            chineseTip,
            englishTip,
            options: [
              {
                id: 'preferred-standard',
                hotelTier: 'preferred_non_five_star',
                vehicleTier: 'standard',
                paxPrices: [{ pax: 2, adultUnitPrice }],
              },
            ],
          },
        }),
      );
      const price = result.options[0].paxPrices[0];

      expect(price.baseCostPerPerson).toBe(90);
      expect(price.adultUnitPrice).toBe(adultUnitPrice);
      expect(price.tipUnitPrice).toBe(chineseTip ?? englishTip ?? 0);
      expect(price.profitPerPerson).toBe(profitPerPerson);
      if (actualMarginRate === null) {
        expect(price.actualMarginRate).toBeNull();
      } else {
        expect(price.actualMarginRate).toBeCloseTo(actualMarginRate, 8);
      }
    },
  );

  it.each([
    { tableCost: 100, dinerCount: 3, unitCost: 33.33 },
    { tableCost: 1, dinerCount: 8, unitCost: 0.13 },
  ])(
    'divides a $tableCost yuan table by $dinerCount diners independently of PAX',
    ({ tableCost, dinerCount, unitCost }) => {
      const result = calculateItineraryQuote(
        quoteInput({
          paxTiers: [2, 5],
          dailyPlans: [
            {
              dayNumber: 1,
              overnightDestination: null,
              items: [
                {
                  type: 'restaurant',
                  resourceName: 'Table meal',
                  unit: 'table',
                  unitCost: tableCost,
                  quantity: 1,
                  dinerCount,
                },
              ],
            },
          ],
        }),
      );

      expect(result.mealCost).toBe(unitCost);
      expect(result.mealDetails).toEqual([
        {
          dayNumber: 1,
          resourceName: 'Table meal',
          unitCost,
          quantity: 1,
          totalCost: unitCost,
        },
      ]);
      expect(result.options[0].paxPrices).toMatchObject([
        { pax: 2, baseCostPerPerson: unitCost, adultUnitPrice: unitCost },
        { pax: 5, baseCostPerPerson: unitCost, adultUnitPrice: unitCost },
      ]);
    },
  );
});
