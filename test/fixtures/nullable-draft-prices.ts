import { plainToInstance } from 'class-transformer';
import { ItineraryInput } from '../../src/inquiries/inquiry.dto';

export const priceResourceIds = {
  hotel: '196fda0c-4337-4d78-b948-71e27ad31aa0',
  guide: '196fda0c-4337-4d78-b948-71e27ad31aa1',
  restaurant: '196fda0c-4337-4d78-b948-71e27ad31aa2',
  attraction: '196fda0c-4337-4d78-b948-71e27ad31aa3',
};

export function priceDraft(price: number | null = 100): ItineraryInput {
  return plainToInstance(ItineraryInput, {
    title: 'Nullable Draft prices',
    startDate: '2026-10-16',
    paxTiers: [10],
    childRate: 80,
    childWithoutBedRate: 60,
    destinations: ['杭州'],
    dailyPlans: [
      {
        id: 'day-1',
        dayNumber: 1,
        date: '2026-10-16',
        departure: '',
        destination: '杭州',
        overnightDestination: '杭州',
        meals: { breakfast: false, lunch: true, dinner: false },
        transport: '',
        description: '当日安排',
        items: (['restaurant', 'attraction'] as const).map((type) => ({
          id: type,
          type,
          resourceId: priceResourceIds[type],
          resourceName: type,
          priceName: '',
          unit: type === 'restaurant' ? 'table' : 'personVisit',
          quantity: 1,
          dinerCount: type === 'restaurant' ? 3 : null,
          unitCost: price,
          totalCost:
            price === null ? null : type === 'restaurant' ? 33.33 : price,
          remark: '',
          referencePrice: 100,
          referenceBasis: 'resource_price',
          adjustmentReason: '',
          ...(type === 'restaurant' ? { mealSlot: 'lunch' } : {}),
        })),
      },
    ],
    hotelPlans: [
      {
        tier: 4,
        hotels: [
          {
            destination: '杭州',
            hotelId: priceResourceIds.hotel,
            hotelName: '酒店',
            rating: 4,
            breakfast: '含早',
            unit: 'roomNight',
            unitCost: price,
            referencePrice: 100,
            referenceBasis: 'hotel_individual',
            adjustmentReason: '',
          },
        ],
      },
    ],
    vehiclePlans: [
      {
        tier: 'standard',
        pricingMode: 'automatic',
        totalPrice: 100,
        arrangements: [
          {
            id: 'range-1',
            startDate: '2026-10-16',
            endDate: '2026-10-16',
            vehicles: [],
            totalPrice: 100,
          },
        ],
      },
    ],
    guidePlans: [
      {
        destination: '杭州',
        guideId: priceResourceIds.guide,
        guideName: '导游服务',
        secondLanguage: 'none',
        shopping: false,
        dailyPrice: price,
        serviceDays: 1,
        referencePrice: 100,
        referenceBasis: 'resource_price',
        adjustmentReason: '',
      },
    ],
    quote: {
      mealOtherCost: null,
      mealOtherReason: '',
      attractionOtherCost: null,
      attractionOtherReason: '',
      paxOtherCosts: [],
      staffRoomCosts: [],
      chineseTip: null,
      englishTip: null,
      transportFees: [],
      customerNotes: '',
      holidayRestrictions: '',
      hotelReplacementTerms: '',
      options: [
        {
          id: 'option-1',
          hotelTier: 4,
          vehicleTier: 'standard',
          paxPrices: [{ pax: 10, adultUnitPrice: null }],
        },
      ],
    },
  });
}
