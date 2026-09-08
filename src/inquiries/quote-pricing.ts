import type {
  ItineraryQuoteCalculation,
  ItineraryQuoteLine,
  ItineraryQuoteOption,
  ItineraryQuoteOptionCalculation,
  ItineraryQuoteSettings,
  ItineraryHotelTier,
  ItineraryRecord,
  ItineraryVehicleTier,
} from './itinerary.types';
import { multiplyMoney, roundMoney, sumMoney } from './money';
const DEFAULT_QUOTE_PROFIT_MARGIN_RATE = 10;
function calculateDestinationNights(plan: Pick<ItineraryRecord, 'dailyPlans'>) {
  const nights: Record<string, number> = {};
  for (const day of plan.dailyPlans)
    if (day.overnightDestination)
      nights[day.overnightDestination] =
        (nights[day.overnightDestination] ?? 0) + 1;
  return nights;
}
function getHotelPlan(
  plan: Pick<ItineraryRecord, 'hotelPlans'>,
  tier: ItineraryHotelTier,
) {
  return plan.hotelPlans.find((p) => p.tier === tier);
}
function getVehiclePlan(
  plan: Pick<ItineraryRecord, 'vehiclePlans'>,
  tier: ItineraryVehicleTier,
) {
  return plan.vehiclePlans.find((p) => p.tier === tier);
}
function calculateVehiclePlanCost(
  plan: ItineraryRecord['vehiclePlans'][number] | undefined,
) {
  return plan?.vehicle
    ? multiplyMoney(plan.vehicle.unitCost, plan.vehicle.serviceDays)
    : 0;
}

export const CHILD_RATE = 70;

export function createDefaultQuoteOption(
  hotelTier: ItineraryHotelTier,
  vehicleTier: ItineraryVehicleTier,
  id = `quote-option-${hotelTier}-${vehicleTier}`,
): ItineraryQuoteOption {
  return {
    id,
    hotelTier,
    vehicleTier,
    adultUnitPrice: null,
    leaderFocEnabled: false,
  };
}

export function createDefaultQuoteSettings(): ItineraryQuoteSettings {
  return {
    options: [],
    chineseTip: null,
    englishTip: null,
    transportFees: [],
    customerNotes: '',
    holidayRestrictions: '',
    hotelReplacementTerms: '如所列酒店满房，将调整为同级酒店。',
  };
}

export function calculateHotelRoomCount(
  itinerary: Pick<ItineraryRecord, 'adults' | 'childrenCount'>,
) {
  const hotelGuestCount = itinerary.adults + itinerary.childrenCount;
  return Math.ceil(hotelGuestCount / 2);
}

export function calculateItineraryQuote(
  itinerary: Pick<
    ItineraryRecord,
    | 'adults'
    | 'childrenCount'
    | 'hotelPlans'
    | 'vehiclePlans'
    | 'quote'
    | 'dailyPlans'
    | 'guidePlans'
  >,
  dailyResourceCost: number,
): ItineraryQuoteCalculation {
  const guideCost = sumMoney(
    itinerary.guidePlans.map((plan) =>
      multiplyMoney(plan.dailyPrice, plan.dayIds.length),
    ),
  );
  const hotelGuestCount = itinerary.adults + itinerary.childrenCount;
  const normalizedDailyResourceCost = roundMoney(dailyResourceCost);
  const adultEquivalentCount =
    itinerary.adults + (itinerary.childrenCount * CHILD_RATE) / 100;
  const hotelRoomCount = calculateHotelRoomCount(itinerary);

  return {
    hotelGuestCount,
    hotelRoomCount,
    dailyResourceCost: normalizedDailyResourceCost,
    guideCost,
    options: itinerary.quote.options.map((option) =>
      calculateQuoteOption(
        option,
        itinerary,
        sumMoney([normalizedDailyResourceCost, guideCost]),
        hotelRoomCount,
        adultEquivalentCount,
      ),
    ),
  };
}

function calculateQuoteOption(
  option: ItineraryQuoteOption,
  itinerary: Pick<
    ItineraryRecord,
    'adults' | 'childrenCount' | 'hotelPlans' | 'vehiclePlans' | 'dailyPlans'
  >,
  dailyResourceCost: number,
  hotelRoomCount: number,
  adultEquivalentCount: number,
): ItineraryQuoteOptionCalculation {
  const hotelPricing = calculateHotelPlanPricing(
    itinerary,
    option.hotelTier,
    hotelRoomCount,
  );
  const vehicleCost = calculateVehiclePlanCost(
    getVehiclePlan(itinerary, option.vehicleTier),
  );
  const commonGroupCost = roundMoney(dailyResourceCost + vehicleCost);
  const baseGroupCost = roundMoney(commonGroupCost + hotelPricing.hotelCost);
  const baseCostPerPerson = adultEquivalentCount
    ? roundMoney(baseGroupCost / adultEquivalentCount)
    : 0;
  const suggestedAdultUnitPrice = calculateSuggestedAdultUnitPrice(
    baseGroupCost,
    adultEquivalentCount,
  );
  const adultUnitPrice =
    option.adultUnitPrice === null
      ? suggestedAdultUnitPrice
      : Math.max(roundMoney(option.adultUnitPrice), 0);
  const childUnitPrice = roundMoney((adultUnitPrice * CHILD_RATE) / 100);
  const lines: ItineraryQuoteLine[] = [
    createQuoteLine('adult', itinerary.adults, adultUnitPrice),
    createQuoteLine('child', itinerary.childrenCount, childUnitPrice),
  ];
  const totalPrice = sumMoney(lines.map((line) => line.totalPrice));
  const profit = roundMoney(totalPrice - baseGroupCost);

  return {
    optionId: option.id,
    hotelTier: option.hotelTier,
    vehicleTier: option.vehicleTier,
    hotelCost: hotelPricing.hotelCost,
    vehicleCost,
    commonGroupCost,
    baseGroupCost,
    baseCostPerPerson,
    singleSupplementUnitCost: hotelPricing.singleSupplementUnitCost,
    adultUnitPrice,
    childUnitPrice,
    totalPrice,
    profit,
    actualMarginRate: totalPrice ? (profit / totalPrice) * 100 : 0,
    lines,
  };
}

function calculateSuggestedAdultUnitPrice(
  totalCost: number,
  adultEquivalentCount: number,
) {
  if (!adultEquivalentCount) return 0;
  const targetTotalPrice =
    totalCost / (1 - DEFAULT_QUOTE_PROFIT_MARGIN_RATE / 100);
  return Math.max(roundMoney(targetTotalPrice / adultEquivalentCount), 0);
}

function calculateHotelPlanPricing(
  itinerary: Pick<ItineraryRecord, 'hotelPlans' | 'dailyPlans'>,
  tier: ItineraryHotelTier,
  hotelRoomCount: number,
) {
  const plan = getHotelPlan(itinerary, tier);
  const destinationNights = calculateDestinationNights(itinerary);
  const roomNightUnitCosts =
    plan?.hotels.flatMap((hotel) =>
      Array.from(
        { length: destinationNights[hotel.destination] ?? 0 },
        () => hotel.unitCost,
      ),
    ) ?? [];
  const roomNightUnitCost = sumMoney(roomNightUnitCosts);
  return {
    hotelCost: multiplyMoney(roomNightUnitCost, hotelRoomCount),
    singleSupplementUnitCost: roundMoney(roomNightUnitCost / 2),
  };
}

function createQuoteLine(
  type: ItineraryQuoteLine['type'],
  quantity: number,
  unitPrice: number,
): ItineraryQuoteLine {
  return {
    type,
    quantity,
    unitPrice,
    totalPrice: multiplyMoney(unitPrice, quantity),
  };
}
