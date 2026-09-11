import {
  calculateItineraryQuote,
  createDefaultQuoteOption,
  createDefaultQuoteSettings,
} from './quote-pricing';

it.each([
  {
    daily: 15850,
    expected: [
      [72850, 8611.11, 6027.78, 80944.44, 8094.44],
      [74350, 8788.42, 6151.89, 82611.14, 8261.14],
      [47350, 5596.93, 3917.85, 52611.14, 5261.14],
      [48850, 5774.23, 4041.96, 54277.76, 5427.76],
    ],
  },
  {
    daily: 15650,
    expected: [
      [72650, 8587.47, 6011.23, 80722.22, 8072.22],
      [74150, 8764.78, 6135.35, 82388.94, 8238.94],
      [47150, 5573.29, 3901.3, 52388.92, 5238.92],
      [48650, 5750.59, 4025.41, 54055.54, 5405.54],
    ],
  },
])(
  'preserves the eight captured quote amounts including cent rounding ($daily daily costs)',
  ({ daily, expected }) => {
    const p = plan();
    p.adults = 8;
    p.childrenCount = 2;
    p.leaderCount = 0;
    p.hotelPlans[0].hotels[0].unitCost = 8800;
    p.hotelPlans.push({
      tier: 'preferred_non_five_star',
      hotels: [{ ...p.hotelPlans[0].hotels[0], unitCost: 3700 }],
    });
    p.vehiclePlans = [
      { tier: 'standard', totalPrice: 2500, arrangements: [] },
      { tier: 'vip', totalPrice: 4000, arrangements: [] },
    ];
    p.guidePlans = [
      {
        destination: '昆明',
        guideId: 'guide',
        guideName: 'Guide',
        secondLanguage: 'en',
        shopping: false,
        dailyPrice: 700,
        serviceDays: 15,
      },
    ];
    p.quote.options = p.hotelPlans.flatMap((h) =>
      p.vehiclePlans.map((v) => createDefaultQuoteOption(h.tier, v.tier)),
    );
    const quote = calculateItineraryQuote(p, daily);
    expect(quote.hotelRoomCount).toBe(5);
    expect(
      quote.options.map((o) => [
        o.baseGroupCost,
        o.adultUnitPrice,
        o.childUnitPrice,
        o.totalPrice,
        o.profit,
      ]),
    ).toEqual(expected);
    expect(quote.options.map((o) => o.singleSupplementUnitCost)).toEqual([
      4400, 4400, 1850, 1850,
    ]);
  },
);
function plan(): Parameters<typeof calculateItineraryQuote>[0] {
  return {
    adults: 19,
    childrenCount: 0,
    leaderCount: 1,
    dailyPlans: [
      {
        id: 'day',
        dayNumber: 1,
        date: '2026-09-11',
        departure: '',
        destination: '昆明',
        overnightDestination: '昆明',
        transport: '',
        meals: { breakfast: false, lunch: false, dinner: false },
        items: [],
      },
    ],
    hotelPlans: [
      {
        tier: 'international_five_star',
        hotels: [
          {
            destination: '昆明',
            hotelId: 'h',
            hotelName: 'Hotel',
            rating: 'international_five_star',
            breakfast: '',
            unit: 'roomNight',
            unitCost: 100,
          },
        ],
      },
    ],
    vehiclePlans: [{ tier: 'standard', totalPrice: 0, arrangements: [] }],
    guidePlans: [],
    quote: {
      ...createDefaultQuoteSettings(),
      options: [
        {
          ...createDefaultQuoteOption('international_five_star', 'standard'),
          adultUnitPrice: 1000,
        },
      ],
    },
  };
}
describe('quote business rules', () => {
  it('charges eleven rooms for nineteen tourists and one separately housed leader, regardless of FOC', () => {
    const p = plan();
    for (const foc of [false, true]) {
      p.quote.options[0].leaderFocEnabled = foc;
      const q = calculateItineraryQuote(p, 0);
      expect(q.hotelRoomCount).toBe(11);
      expect(q.options[0]).toMatchObject({
        hotelCost: 1100,
        totalPrice: 19000,
        profit: 17900,
        singleSupplementUnitCost: 50,
      });
    }
  });
  it('charges the supplier vehicle total once and guides at edited daily price times service days', () => {
    const p = plan();
    p.vehiclePlans[0].totalPrice = 8000;
    p.guidePlans = [
      {
        destination: '昆明',
        guideId: 'g',
        guideName: '中文+英文 · 不进店',
        secondLanguage: 'en',
        shopping: false,
        dailyPrice: 450,
        serviceDays: 7,
      },
    ];
    const q = calculateItineraryQuote(p, 1200);
    expect(q.guideCost).toBe(3150);
    expect(q.options[0]).toMatchObject({
      vehicleCost: 8000,
      baseGroupCost: 13450,
    });
  });
  it('excludes all extra fees from costs and per-person tour prices', () => {
    const p = plan();
    p.adults = 60;
    const before = calculateItineraryQuote(p, 0);
    p.quote.otherExpenses = 100000;
    p.quote.chineseTip = 5000;
    p.quote.englishTip = 6000;
    p.quote.transportFees = [
      {
        id: 'flight',
        type: 'flight',
        departureCity: 'A',
        arrivalCity: 'B',
        cabin: 'economy',
        unitPrice: 2000,
      },
      {
        id: 'train',
        type: 'train',
        departureCity: 'B',
        arrivalCity: 'C',
        cabin: 'first',
        unitPrice: 500,
      },
    ];
    const after = calculateItineraryQuote(p, 0);
    expect(after).toEqual(before);
    expect(after.options[0].totalPrice).toBe(60000);
  });
  it('keeps full-tour tips out of cost, tour price and profit for adults and children', () => {
    const p = plan();
    p.adults = 8;
    p.childrenCount = 2;
    const before = calculateItineraryQuote(p, 0);
    p.quote.chineseTip = 3000;
    p.quote.englishTip = 5000;
    expect(calculateItineraryQuote(p, 0)).toEqual(before);
  });
  it('uses actual hotel prices for each city night and keeps child pricing at seventy percent', () => {
    const p = plan();
    p.adults = 2;
    p.childrenCount = 1;
    p.dailyPlans.push({
      ...p.dailyPlans[0],
      id: 'second',
      overnightDestination: '大理',
    });
    p.hotelPlans[0].hotels.push({
      ...p.hotelPlans[0].hotels[0],
      destination: '大理',
      hotelId: 'h2',
      unitCost: 300,
    });
    expect(calculateItineraryQuote(p, 0).options[0]).toMatchObject({
      hotelCost: 1200,
      singleSupplementUnitCost: 200,
      childUnitPrice: 700,
      totalPrice: 2700,
    });
  });
});
