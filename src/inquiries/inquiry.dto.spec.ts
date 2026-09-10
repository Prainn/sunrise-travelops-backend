import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ContactInput, ItineraryInput, LogQuery } from './inquiry.dto';
const valid = {
  title: 'Test',
  startDate: '2026-09-08',
  adults: 1,
  childrenCount: 0,
  leaderCount: 0,
  destinations: ['昆明'],
  dailyPlans: [
    {
      id: 'day-1',
      dayNumber: 1,
      date: '2026-09-08',
      departure: '',
      destination: '',
      overnightDestination: null,
      meals: { breakfast: false, lunch: false, dinner: false },
      transport: '',
      items: [],
    },
  ],
  hotelPlans: [],
  vehiclePlans: [],
  guidePlans: [],
  quote: {
    options: [],
    chineseTip: null,
    englishTip: null,
    transportFees: [],
    otherExpenses: 0,
    customerNotes: '',
    holidayRestrictions: '',
    hotelReplacementTerms: '',
  },
};
const validate = (value: unknown) =>
  validateSync(plainToInstance(ItineraryInput, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
describe('itinerary input', () => {
  it('accepts an incomplete draft and rejects missing nested settings or spoofed status', () => {
    expect(validate(valid)).toHaveLength(0);
    expect(validate({ ...valid, quote: undefined }).length).toBeGreaterThan(0);
    expect(validate({ ...valid, status: 'quoted' }).length).toBeGreaterThan(0);
    expect(validate({ ...valid, adults: 0 }).length).toBeGreaterThan(0);
  });
  it('allows at most one whole-trip guide type', () => {
    const guide = {
      destination: '昆明',
      guideId: '00000000-0000-4000-8000-000000000001',
      guideName: '英文 · 不进店',
      secondLanguage: 'en',
      shopping: false,
      dailyPrice: 600,
      serviceDays: 7,
    };
    expect(validate({ ...valid, guidePlans: [guide] })).toHaveLength(0);
    expect(
      validate({ ...valid, guidePlans: [guide, guide] }).some(
        (error) => error.property === 'guidePlans',
      ),
    ).toBe(true);
  });
  it('accepts optional vehicle range prices and validates them as money', () => {
    const vehiclePlan = {
      tier: 'standard',
      totalPrice: '4000.00',
      arrangements: [
        {
          id: 'vehicle-range-1',
          startDate: '2026-09-08',
          endDate: '2026-09-08',
          vehicles: [],
          totalPrice: '1000.00',
        },
      ],
    };
    expect(validate({ ...valid, vehiclePlans: [vehiclePlan] })).toHaveLength(0);
    expect(
      validate({
        ...valid,
        vehiclePlans: [
          {
            ...vehiclePlan,
            arrangements: [{ ...vehiclePlan.arrangements[0], totalPrice: -1 }],
          },
        ],
      }).length,
    ).toBeGreaterThan(0);
  });
  it('rejects invalid report dates and pagination', () => {
    expect(
      validateSync(
        plainToInstance(LogQuery, { from: '2026-02-30', pageSize: 101 }),
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe('inquiry contact input', () => {
  it('accepts and trims a contact phone, including an empty phone', () => {
    for (const phone of [' +86 13800138000 ', '']) {
      const input = plainToInstance(ContactInput, { name: ' 李明 ', phone });
      expect(
        validateSync(input, { whitelist: true, forbidNonWhitelisted: true }),
      ).toHaveLength(0);
      expect(input.phone).toBe(phone.trim());
    }
    expect(
      validateSync(plainToInstance(ContactInput, { name: '李明', phone: 123 }))
        .length,
    ).toBeGreaterThan(0);
  });
});
