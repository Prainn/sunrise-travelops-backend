import type {
  ItineraryRecord,
  ItineraryQuoteCalculation,
} from './itinerary.types';
import { divideMoney, multiplyMoney, roundMoney, sumMoney } from './money';
import { BusinessException } from '../common/exceptions/business.exception';
import { hotelForDay } from './hotel-days';

type QuotePlan = Pick<
  ItineraryRecord,
  | 'paxTiers'
  | 'childRate'
  | 'childWithoutBedRate'
  | 'hotelPlans'
  | 'vehiclePlans'
  | 'quote'
  | 'dailyPlans'
  | 'guidePlans'
>;

/** Stable API paths for selected resources whose actual price is not ready. */
export function missingItineraryPrices(
  itinerary: Pick<QuotePlan, 'hotelPlans' | 'guidePlans' | 'dailyPlans'> &
    Partial<Pick<QuotePlan, 'vehiclePlans' | 'paxTiers'>>,
): string[] {
  const missing: string[] = [];
  const ready = (price: number | null) =>
    price !== null && Number.isFinite(price) && price >= 0;
  for (const plan of itinerary.hotelPlans)
    for (const hotel of plan.hotels)
      if (!ready(hotel.unitCost))
        missing.push(
          `hotelPlans[${plan.tier}].hotels[${hotel.dayId ?? hotel.destination}].unitCost`,
        );
  for (const guide of itinerary.guidePlans)
    if (!ready(guide.dailyPrice))
      missing.push(`guidePlans[${guide.destination}].dailyPrice`);
  for (const day of itinerary.dailyPlans)
    for (const item of day.items)
      if (!ready(item.unitCost))
        missing.push(`dailyPlans[${day.id}].items[${item.id}].unitCost`);
  for (const plan of itinerary.vehiclePlans ?? [])
    if (plan.arrangements.length)
      for (const pax of itinerary.paxTiers ?? [])
        if (
          !ready(plan.paxPrices?.find((p) => p.pax === pax)?.totalPrice ?? null)
        )
          missing.push(
            `vehiclePlans[${plan.tier}].paxPrices[${pax}].totalPrice`,
          );
  return missing;
}

export function calculateItineraryQuote(
  itinerary: QuotePlan,
  resourceCities: ReadonlyMap<string, string> = new Map(),
): ItineraryQuoteCalculation {
  if (
    itinerary.quote.chineseTip !== null &&
    itinerary.quote.englishTip !== null
  )
    throw new BusinessException({
      code: 'ITINERARY_INVALID',
      message: '中文和第二语言小费只能填写一种',
      status: 400,
    });
  const guideCost = sumMoney(
    itinerary.guidePlans
      .filter((plan) => plan.dailyPrice !== null)
      .map((plan) => multiplyMoney(plan.dailyPrice!, plan.serviceDays)),
  );
  const resourceCosts = itinerary.dailyPlans.flatMap((day) =>
    day.items.map((item) => {
      if (
        item.unit === 'table' &&
        item.tableCount == null &&
        !(item.dinerCount && item.dinerCount > 0)
      ) {
        throw new BusinessException({
          code: 'ITINERARY_INVALID',
          message: '请补充按桌餐食的每桌人数',
          status: 400,
        });
      }
      const unitCost =
        item.unitCost === null
          ? null
          : item.tableCount != null
            ? 0
            : item.unit === 'table'
              ? divideMoney(item.unitCost, item.dinerCount!)
              : item.unitCost;
      return {
        type: item.type,
        detail: {
          city: resourceCities.get(`${item.type}:${item.resourceId}`) ?? null,
          dayNumber: day.dayNumber,
          resourceName: item.resourceName,
          unitCost,
          ...(item.tableCount != null
            ? {
                groupTotal:
                  item.unitCost == null
                    ? null
                    : multiplyMoney(item.unitCost, item.tableCount),
              }
            : {}),
          quantity: item.quantity,
          totalCost:
            unitCost === null ? null : multiplyMoney(unitCost, item.quantity),
        },
      };
    }),
  );
  const mealDetails = resourceCosts
    .filter((item) => item.type === 'restaurant')
    .map((item) => item.detail);
  const attractionDetails = resourceCosts
    .filter((item) => item.type === 'attraction')
    .map((item) => item.detail);
  const tableTotal = sumMoney(
    itinerary.dailyPlans
      .flatMap((day) => day.items)
      .filter((item) => item.unit === 'table' && item.tableCount != null)
      .map((item) => multiplyMoney(item.unitCost ?? 0, item.tableCount!)),
  );
  // Pax-independent resource cost; other costs are group totals spread per PAX below.
  const mealCost = sumMoney(
    mealDetails.flatMap((item) =>
      item.totalCost === null ? [] : [item.totalCost],
    ),
  );
  const attractionCost = sumMoney(
    attractionDetails.flatMap((item) =>
      item.totalCost === null ? [] : [item.totalCost],
    ),
  );
  const dailyResourceCost = sumMoney([mealCost, attractionCost]);
  const tipUnitPrice = roundMoney(
    itinerary.quote.chineseTip ?? itinerary.quote.englishTip ?? 0,
  );
  const missingPrices = missingItineraryPrices(itinerary);
  return {
    pricingVersion: 2,
    tableMealTotal: tableTotal,
    pricingComplete: missingPrices.length === 0,
    missingPrices,
    dailyResourceCost,
    mealDetails,
    attractionDetails,
    mealCost,
    attractionCost,
    guideCost,
    options: itinerary.quote.options.map((option) => {
      const hotels =
        itinerary.hotelPlans.find((plan) => plan.tier === option.hotelTier)
          ?.hotels ?? [];
      let accumulatedRoomCost = 0;
      // Each overnight day carries its own hotel night; days of one city may differ.
      const hotelCityCosts = itinerary.dailyPlans
        .filter((day) => day.overnightDestination)
        .map((day) => {
          const hotel = hotelForDay(hotels, day);
          const unitCost = hotel?.unitCost ?? null;
          const previousTotal = divideMoney(accumulatedRoomCost, 2);
          if (unitCost !== null)
            accumulatedRoomCost = sumMoney([accumulatedRoomCost, unitCost]);
          // Allocate any half-cent rounding to the current night so the breakdown equals the total.
          const totalCost =
            unitCost === null
              ? null
              : roundMoney(divideMoney(accumulatedRoomCost, 2) - previousTotal);
          return {
            dayNumber: day.dayNumber,
            hotelName: hotel?.hotelName ?? null,
            destination: day.overnightDestination!,
            nights: 1,
            unitCost,
            totalCost,
          };
        });
      const hotelUnitCost = divideMoney(accumulatedRoomCost, 2);
      const vehiclePlan = itinerary.vehiclePlans.find(
        (plan) => plan.tier === option.vehicleTier,
      );
      const staffRoomTotal = sumMoney(
        itinerary.quote.staffRoomCosts.map((cost) => cost.total ?? 0),
      );
      return {
        optionId: option.id,
        hotelTier: option.hotelTier,
        vehicleTier: option.vehicleTier,
        hotelCityCosts,
        hotelUnitCost,
        vehicleTotal: null,
        staffRoomTotal,
        paxPrices: itinerary.paxTiers.map((pax) => {
          const paxOtherCost = itinerary.quote.paxOtherCosts.find(
            (cost) => cost.pax === pax,
          );
          const paxVehicleTotal =
            vehiclePlan?.paxPrices?.find((p) => p.pax === pax)?.totalPrice ??
            null;
          const vehicleUnitCost = divideMoney(paxVehicleTotal ?? 0, pax);
          const guideServiceUnitCost = sumMoney([
            divideMoney(guideCost, pax),
            divideMoney(paxOtherCost?.guideOtherCost ?? 0, pax),
          ]);
          const staffRoomUnitCost = sumMoney([
            divideMoney(staffRoomTotal, pax),
            divideMoney(paxOtherCost?.staffRoomOtherCost ?? 0, pax),
          ]);
          const tableMealUnitCost = sumMoney(
            mealDetails.map((item) => divideMoney(item.groupTotal ?? 0, pax)),
          );
          const paxMealCost = sumMoney([
            mealCost,
            tableMealUnitCost,
            divideMoney(itinerary.quote.mealOtherCost ?? 0, pax),
          ]);
          const paxAttractionCost = sumMoney([
            attractionCost,
            divideMoney(itinerary.quote.attractionOtherCost ?? 0, pax),
          ]);
          const baseCostPerPerson = sumMoney([
            hotelUnitCost,
            paxMealCost,
            paxAttractionCost,
            vehicleUnitCost,
            guideServiceUnitCost,
            staffRoomUnitCost,
          ]);
          const adultUnitPrice = roundMoney(
            option.paxPrices.find((price) => price.pax === pax)
              ?.adultUnitPrice ?? baseCostPerPerson,
          );
          const revenue = sumMoney([adultUnitPrice, tipUnitPrice]);
          const profitPerPerson = roundMoney(revenue - baseCostPerPerson);
          return {
            pax,
            vehicleTotal: paxVehicleTotal,
            vehicleUnitCost,
            guideServiceUnitCost,
            staffRoomUnitCost,
            baseCostPerPerson,
            mealCost: paxMealCost,
            attractionCost: paxAttractionCost,
            adultUnitPrice,
            childWithoutBedUnitPrice: multiplyMoney(
              adultUnitPrice,
              itinerary.childWithoutBedRate,
              100,
            ),
            childUnitPrice: multiplyMoney(
              adultUnitPrice,
              itinerary.childRate,
              100,
            ),
            leaderUnitPrice: hotelUnitCost,
            singleSupplementUnitCost: hotelUnitCost,
            tipUnitPrice,
            profitPerPerson,
            actualMarginRate: revenue
              ? (profitPerPerson / revenue) * 100
              : null,
          };
        }),
      };
    }),
  };
}
