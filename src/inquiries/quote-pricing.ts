import type { ItineraryRecord, PaxQuoteCalculation } from './itinerary.types';
import { multiplyMoney, roundMoney, sumMoney } from './money';
import { BusinessException } from '../common/exceptions/business.exception';

type QuotePlan = Pick<
  ItineraryRecord,
  | 'paxTiers'
  | 'childRate'
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
  const dailyResourceCost = sumMoney(
    itinerary.dailyPlans.flatMap((day) =>
      day.items.map((item) => {
        if (
          item.unit === 'table' &&
          !(item.dinerCount && item.dinerCount > 0)
        ) {
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
        return multiplyMoney(unitCost, item.quantity);
      }),
    ),
  );
  const tipUnitPrice = roundMoney(
    itinerary.quote.chineseTip ?? itinerary.quote.englishTip ?? 0,
  );
  return {
    pricingVersion: 2,
    dailyResourceCost,
    guideCost,
    options: itinerary.quote.options.map((option) => {
      const hotels =
        itinerary.hotelPlans.find((plan) => plan.tier === option.hotelTier)
          ?.hotels ?? [];
      const roomCost = sumMoney(
        itinerary.dailyPlans.map(
          (day) =>
            hotels.find(
              (hotel) => hotel.destination === day.overnightDestination,
            )?.unitCost ?? 0,
        ),
      );
      const hotelUnitCost = roundMoney(roomCost / 2);
      const vehicleTotal = roundMoney(
        itinerary.vehiclePlans.find((plan) => plan.tier === option.vehicleTier)
          ?.totalPrice ?? 0,
      );
      const guideServiceTotal = roundMoney(
        option.guideServiceTotal ?? guideCost,
      );
      const staffRoomTotal = roundMoney(option.staffRoomTotal ?? 0);
      return {
        optionId: option.id,
        hotelTier: option.hotelTier,
        vehicleTier: option.vehicleTier,
        hotelUnitCost,
        vehicleTotal,
        guideServiceTotal,
        staffRoomTotal,
        paxPrices: itinerary.paxTiers.map((pax) => {
          const vehicleUnitCost = roundMoney(vehicleTotal / pax);
          const guideServiceUnitCost = roundMoney(guideServiceTotal / pax);
          const staffRoomUnitCost = roundMoney(staffRoomTotal / pax);
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
