import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ContactInput, ItineraryInput, LogQuery } from './inquiry.dto';
const valid = {
  title: 'Test',
  startDate: '2026-09-08',
  adults: 1,
  childrenCount: 0,
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
