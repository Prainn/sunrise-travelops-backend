import type { ItineraryRecord, PaxQuoteCalculation } from './itinerary.types';
import { multiplyMoney, roundMoney, sumMoney } from './money';
import { BusinessException } from '../common/exceptions/business.exception';

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

export function calculateItineraryQuote(
  itinerary: QuotePlan,
): PaxQuoteCalculation {
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
    itinerary.guidePlans.map((plan) =>
      multiplyMoney(plan.dailyPrice, plan.serviceDays),
    ),
  );
  const resourceCosts = itinerary.dailyPlans.flatMap((day) =>
    day.items.map((item) => {
      if (item.unit === 'table' && !(item.dinerCount && item.dinerCount > 0)) {
        throw new BusinessException({
          code: 'ITINERARY_INVALID',
          message: '请补充按桌餐食的每桌人数',
          status: 400,
        });
      }
      const unitCost =
        item.unit === 'table'
          ? roundMoney(item.unitCost / item.dinerCount!)
          : item.unitCost;
      return {
        type: item.type,
        detail: {
          dayNumber: day.dayNumber,
          resourceName: item.resourceName,
          unitCost,
          quantity: item.quantity,
          totalCost: multiplyMoney(unitCost, item.quantity),
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
  const mealCost = sumMoney([
    ...mealDetails.map((item) => item.totalCost),
    itinerary.quote.mealOtherCost ?? 0,
  ]);
  const attractionCost = sumMoney([
    ...attractionDetails.map((item) => item.totalCost),
    itinerary.quote.attractionOtherCost ?? 0,
  ]);
  const dailyResourceCost = sumMoney([mealCost, attractionCost]);
  const tipUnitPrice = roundMoney(
    itinerary.quote.chineseTip ?? itinerary.quote.englishTip ?? 0,
  );
  return {
    pricingVersion: 2,
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
      const nightsByCity = new Map<string, number>();
      for (const day of itinerary.dailyPlans) {
        if (day.overnightDestination)
          nightsByCity.set(
            day.overnightDestination,
            (nightsByCity.get(day.overnightDestination) ?? 0) + 1,
          );
      }
      let accumulatedRoomCost = 0;
      const hotelCityCosts = [...nightsByCity].map(([destination, nights]) => {
        const unitCost =
          hotels.find((hotel) => hotel.destination === destination)?.unitCost ??
          0;
        const previousTotal = roundMoney(accumulatedRoomCost / 2);
        accumulatedRoomCost = sumMoney([
          accumulatedRoomCost,
          multiplyMoney(unitCost, nights),
        ]);
        // Allocate any half-cent rounding to the current city so the breakdown equals the existing total.
        const totalCost = roundMoney(
          roundMoney(accumulatedRoomCost / 2) - previousTotal,
        );
        return { destination, nights, unitCost, totalCost };
      });
      const hotelUnitCost = roundMoney(accumulatedRoomCost / 2);
      const vehicleTotal = roundMoney(
        itinerary.vehiclePlans.find((plan) => plan.tier === option.vehicleTier)
          ?.totalPrice ?? 0,
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
        vehicleTotal,
        staffRoomTotal,
        paxPrices: itinerary.paxTiers.map((pax) => {
          const paxOtherCost = itinerary.quote.paxOtherCosts.find(
            (cost) => cost.pax === pax,
          );
          const vehicleUnitCost = roundMoney(vehicleTotal / pax);
          const guideServiceUnitCost = sumMoney([
            roundMoney(guideCost / pax),
            paxOtherCost?.guideOtherCost ?? 0,
          ]);
          const staffRoomUnitCost = sumMoney([
            roundMoney(staffRoomTotal / pax),
            paxOtherCost?.staffRoomOtherCost ?? 0,
          ]);
          const baseCostPerPerson = sumMoney([
            hotelUnitCost,
            dailyResourceCost,
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
            vehicleUnitCost,
            guideServiceUnitCost,
            staffRoomUnitCost,
            baseCostPerPerson,
            adultUnitPrice,
            childWithoutBedUnitPrice: roundMoney(
              (adultUnitPrice * itinerary.childWithoutBedRate) / 100,
            ),
            childUnitPrice: roundMoney(
              (adultUnitPrice * itinerary.childRate) / 100,
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
