import { ResourceLibrary } from '../users/user-identity.entity';
import { requirePriceReason, vehicleSegmentTotal } from './price-adjustments';
import { ResourceStatus } from '../resources/common/resource.constants';
import { HttpStatus, Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception';
import { CityEntity } from '../resources/cities/city.entity';
import { HotelEntity } from '../resources/hotels/hotel.entity';
import { TransportEntity } from '../resources/transports/transport.entity';
import { GuideEntity } from '../resources/guides/guide.entity';
import { RestaurantPriceEntity } from '../resources/restaurants/restaurant.entity';
import { AttractionPriceEntity } from '../resources/attractions/attraction.entity';
import { ItineraryInput } from './inquiry.dto';
import { multiplyMoney, roundMoney } from './money';
import { randomUUID } from 'node:crypto';
export function invalid(message: string): never {
  throw new BusinessException({
    code: 'ITINERARY_INVALID',
    message,
    status: HttpStatus.BAD_REQUEST,
  });
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length)
    invalid('Duplicate itinerary record');
}
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function dateAt(start: string, index: number) {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}
@Injectable()
export class ItineraryValidation {
  async normalize(
    manager: EntityManager,
    input: ItineraryInput,
    previous?: ItineraryInput,
    plannedDays = input.dailyPlans.length,
    library?: ResourceLibrary,
    checkReason = true,
  ): Promise<ItineraryInput> {
    const plan = structuredClone(input);
    const previousDayCount = previous?.dailyPlans.length;
    if (
      plan.dailyPlans.length !== plannedDays &&
      plan.dailyPlans.length !== previousDayCount
    )
      invalid('行程天数必须与询盘计划天数一致');
    const newCities = plan.destinations.filter(
      (city) => !previous?.destinations.includes(city),
    );
    if (newCities.length) {
      const cities = await manager.find(CityEntity, {
        where: { name: In(newCities), library },
      });
      if (
        cities.filter((city) => city.status === ResourceStatus.Enabled)
          .length !== newCities.length
      )
        invalid('Invalid destination');
    }
    plan.paxTiers.sort((a, b) => a - b);
    const guestCount = Math.max(...plan.paxTiers);
    unique(
      plan.dailyPlans.flatMap((day) => [
        day.id,
        ...day.items.map((item) => item.id),
      ]),
    );
    unique(plan.hotelPlans.map((p) => p.tier));
    unique(plan.vehiclePlans.map((p) => p.tier));
    unique(plan.guidePlans.map((p) => p.destination));
    unique(plan.quote.options.map((p) => p.id));
    unique(plan.quote.transportFees.map((p) => p.id));
    plan.dailyPlans.forEach((day, index) => {
      day.dayNumber = index + 1;
      day.date = dateAt(plan.startDate, index);
      day.overnightDestination ??= null;
      if (
        day.overnightDestination &&
        !plan.destinations.includes(day.overnightDestination)
      )
        invalid('Invalid overnight destination');
      for (const slot of ['lunch', 'dinner'] as const) {
        const items = day.items.filter(
          (item) => item.type === 'restaurant' && item.mealSlot === slot,
        );
        if (items.length > 1 || (!day.meals[slot] && items.length))
          invalid('Invalid meal assignment');
      }
    });
    for (const item of plan.dailyPlans.flatMap((day) => day.items)) {
      if (item.type === 'restaurant' && !item.mealSlot)
        invalid('Meal slot required');
      if (item.type === 'attraction' && item.mealSlot)
        invalid('Attraction cannot be a meal');
      const old = previous?.dailyPlans
        .flatMap((day) => day.items)
        .find(
          (v) =>
            v.id === item.id &&
            v.type === item.type &&
            v.resourceId === item.resourceId &&
            v.resourcePriceId === item.resourcePriceId,
        );
      const customRestaurant =
        item.type === 'restaurant' &&
        item.resourceId === null &&
        item.resourcePriceId === null;
      if (customRestaurant) {
        item.resourceName = item.resourceName.trim();
        if (
          !item.resourceName ||
          !['personMeal', 'table'].includes(item.unit) ||
          !Number.isFinite(item.quantity) ||
          item.quantity <= 0 ||
          !Number.isFinite(item.unitCost) ||
          item.unitCost < 0
        )
          invalid('Invalid custom restaurant');
        item.priceName = '';
        item.referencePrice = null;
        item.referenceBasis = 'unknown';
      } else if (old)
        Object.assign(item, {
          resourceName: old.resourceName,
          priceName: old.priceName,
          unit: old.unit,
          dinerCount: old.dinerCount ?? item.dinerCount ?? null,
          referencePrice: old.referencePrice ?? null,
          referenceBasis: old.referenceBasis ?? 'unknown',
        });
      else if (item.type === 'restaurant') {
        const price = await manager.findOne(RestaurantPriceEntity, {
          where: { id: item.resourcePriceId!, restaurantId: item.resourceId! },
          relations: { restaurant: true },
        });
        if (
          !price?.restaurant ||
          price.restaurant.deletedAt ||
          price.restaurant.status !== ResourceStatus.Enabled ||
          (library && price.restaurant.library !== library)
        )
          invalid('Invalid restaurant price');
        Object.assign(item, {
          resourceName: price.restaurant.name,
          priceName: price.menuName,
          unit: price.unit,
          dinerCount:
            price.unit === 'table'
              ? (price.dinerCount ?? item.dinerCount ?? null)
              : null,
          referencePrice: Number(price.price),
          referenceBasis: 'resource_price',
        });
      } else {
        const price = await manager.findOne(AttractionPriceEntity, {
          where: { id: item.resourcePriceId!, attractionId: item.resourceId! },
          relations: { attraction: true },
        });
        if (
          !price?.attraction ||
          price.attraction.deletedAt ||
          price.attraction.status !== ResourceStatus.Enabled ||
          (library && price.attraction.library !== library)
        )
          invalid('Invalid attraction price');
        Object.assign(item, {
          resourceName: price.attraction.name,
          priceName: price.itemName,
          unit: price.unit,
          referencePrice: Number(price.settlementPrice),
          referenceBasis: 'resource_price',
        });
      }
      requirePriceReason(item.unitCost, old?.unitCost, item, old, checkReason);
      if (
        item.unit === 'table' &&
        !(
          item.dinerCount &&
          Number.isInteger(item.dinerCount) &&
          item.dinerCount > 0
        )
      )
        invalid('请补充按桌餐食的每桌人数');
      if (item.unit !== 'table') item.dinerCount = null;
      item.totalCost = multiplyMoney(
        item.unit === 'table'
          ? roundMoney(item.unitCost / item.dinerCount!)
          : item.unitCost,
        item.quantity,
      );
    }
    for (const group of plan.hotelPlans) {
      unique(group.hotels.map((h) => h.destination));
      for (const selection of group.hotels) {
        if (!plan.destinations.includes(selection.destination))
          invalid('Hotel city outside itinerary');
        const old = previous?.hotelPlans
          .find((p) => p.tier === group.tier)
          ?.hotels.find(
            (h) =>
              h.destination === selection.destination &&
              h.hotelId === selection.hotelId,
          );
        if (old && selection.referenceBasis === old.referenceBasis)
          Object.assign(selection, {
            hotelName: old.hotelName,
            rating: old.rating,
            breakfast: old.breakfast,
            unit: old.unit,
            referencePrice: old.referencePrice ?? null,
            referenceBasis: old.referenceBasis ?? 'unknown',
            unitCost: roundMoney(selection.unitCost),
          });
        else {
          const hotel = await manager.findOneBy(HotelEntity, {
            id: selection.hotelId,
          });
          const rating =
            group.tier === 'international_five_star'
              ? 'international_five_star'
              : 'ctrip_preferred';
          if (
            !hotel ||
            hotel.status !== ResourceStatus.Enabled ||
            hotel.city !== selection.destination ||
            hotel.rating !== rating ||
            (library && hotel.library !== library)
          )
            invalid('Hotel does not match city or tier');
          const groupRate = selection.referenceBasis === 'hotel_group';
          if (groupRate && hotel.groupPrice == null)
            invalid('Hotel group price unavailable');
          if (
            !['hotel_group', 'hotel_individual'].includes(
              selection.referenceBasis ?? '',
            )
          )
            invalid('请选择酒店参考价');
          Object.assign(selection, {
            referencePrice: Number(
              groupRate ? hotel.groupPrice : hotel.individualPrice,
            ),
            referenceBasis: groupRate ? 'hotel_group' : 'hotel_individual',
            hotelName: hotel.name,
            rating: hotel.rating,
            breakfast: hotel.breakfast,
            unit: hotel.unit,
            unitCost: roundMoney(selection.unitCost),
          });
        }
        requirePriceReason(
          selection.unitCost,
          old && (old.referenceBasis ?? 'unknown') === selection.referenceBasis
            ? old.unitCost
            : undefined,
          selection,
          old,
          checkReason,
        );
      }
    }
    const itineraryEndDate = dateAt(plan.startDate, plannedDays - 1);
    for (const group of plan.vehiclePlans) {
      unique(group.arrangements.map((a) => a.id));
      group.totalPrice ??= null;
      if (!group.arrangements.length) group.totalPrice = null;
      if (group.totalPrice !== null)
        group.totalPrice = roundMoney(group.totalPrice);
      const assignedRanges: Array<{ startDate: string; endDate: string }> = [];
      for (const arrangement of group.arrangements) {
        unique(arrangement.vehicles.map((v) => v.vehicleId));
        arrangement.totalPrice ??= null;
        if (arrangement.totalPrice !== null)
          arrangement.totalPrice = roundMoney(arrangement.totalPrice);
        const hasStartDate = Boolean(arrangement.startDate);
        const hasEndDate = Boolean(arrangement.endDate);
        if (hasStartDate !== hasEndDate)
          invalid('Incomplete vehicle date range');
        if (hasStartDate) {
          if (
            !isCalendarDate(arrangement.startDate) ||
            !isCalendarDate(arrangement.endDate) ||
            arrangement.startDate < plan.startDate ||
            arrangement.endDate > itineraryEndDate ||
            arrangement.startDate > arrangement.endDate
          )
            invalid('Invalid vehicle date range');
          if (
            assignedRanges.some(
              (range) =>
                arrangement.startDate <= range.endDate &&
                arrangement.endDate >= range.startDate,
            )
          )
            invalid('Vehicle date ranges overlap');
          assignedRanges.push(arrangement);
        }
        for (const vehicle of arrangement.vehicles) {
          const oldVehicle = previous?.vehiclePlans
            .find((p) => p.tier === group.tier)
            ?.arrangements.flatMap((a) => a.vehicles)
            .find((v) => v.vehicleId === vehicle.vehicleId);
          if (oldVehicle) {
            vehicle.vehicleName = oldVehicle.vehicleName;
            vehicle.seats = oldVehicle.seats;
            continue;
          }
          const resource = await manager.findOneBy(TransportEntity, {
            id: vehicle.vehicleId,
          });
          if (
            !resource ||
            resource.status !== ResourceStatus.Enabled ||
            resource.serviceLevel !== group.tier ||
            (library && resource.library !== library)
          )
            invalid('Invalid vehicle');
          Object.assign(vehicle, {
            vehicleName: resource.name,
            seats: resource.seats,
          });
        }
        const seats = arrangement.vehicles.reduce(
          (sum, v) => sum + v.seats * v.quantity,
          0,
        );
        if (hasStartDate && seats < guestCount)
          invalid('Vehicle has insufficient seats');
      }
      const old = previous?.vehiclePlans.find((p) => p.tier === group.tier);
      group.segmentTotal = vehicleSegmentTotal(group);
      group.pricingMode ??=
        old?.pricingMode ??
        (old
          ? 'unknown'
          : group.segmentTotal != null &&
              (group.totalPrice == null ||
                group.totalPrice === group.segmentTotal)
            ? 'automatic'
            : 'manual');
      if (group.pricingMode === 'automatic') {
        if (group.segmentTotal == null && group.arrangements.length)
          invalid('Automatic vehicle pricing needs complete segment prices');
        group.totalPrice = group.segmentTotal;
        group.adjustmentReason = '';
      } else if (group.totalPrice != null) {
        const fields = {
          referencePrice: group.segmentTotal,
          adjustmentReason: group.adjustmentReason,
        };
        if (old?.totalPrice == null) fields.adjustmentReason = '';
        else
          requirePriceReason(
            group.totalPrice,
            old.totalPrice,
            fields,
            old,
            checkReason,
            true,
          );
        group.adjustmentReason = fields.adjustmentReason;
      }
    }
    for (const guide of plan.guidePlans) {
      if (!plan.destinations.includes(guide.destination))
        invalid('Invalid guide destination');
      const old = previous?.guidePlans.find((g) => g.guideId === guide.guideId);
      if (old)
        Object.assign(guide, {
          guideName: old.guideName,
          secondLanguage: old.secondLanguage,
          shopping: old.shopping,
          referencePrice: old.referencePrice ?? null,
          referenceBasis: old.referenceBasis ?? 'unknown',
        });
      else {
        const resource = await manager.findOneBy(GuideEntity, {
          id: guide.guideId,
        });
        if (
          !resource ||
          resource.status !== ResourceStatus.Enabled ||
          (library && resource.library !== library)
        )
          invalid('Invalid guide');
        Object.assign(guide, {
          guideName: resource.name,
          secondLanguage: resource.secondLanguage,
          shopping: resource.shopping,
          referencePrice: Number(resource.dailyPrice),
          referenceBasis: 'resource_price',
        });
      }
      guide.dailyPrice = roundMoney(guide.dailyPrice);
      guide.serviceDays = plannedDays;
      requirePriceReason(
        guide.dailyPrice,
        old?.dailyPrice,
        guide,
        old,
        checkReason,
      );
    }
    plan.dailyPlans.forEach((day, index) => {
      const overnight = plan.dailyPlans[index - 1]?.overnightDestination;
      const hotels = plan.hotelPlans
        .filter((p) => p.hotels.length)
        .map((p) => p.hotels.find((h) => h.destination === overnight));
      day.meals.breakfast = Boolean(
        overnight && hotels.length && hotels.every((h) => Boolean(h)),
      );
    });
    const options = plan.quote.options;
    unique(options.map((o) => `${o.hotelTier}:${o.vehicleTier}`));
    for (const option of options) {
      unique(option.paxPrices.map((price) => String(price.pax)));
      if (option.paxPrices.some((price) => !plan.paxTiers.includes(price.pax)))
        invalid('报价档位不属于行程');
      unique(option.staffRoomCosts.map((cost) => cost.destination));
      if (
        option.staffRoomCosts.some(
          (cost) => !plan.destinations.includes(cost.destination),
        )
      )
        invalid('司陪房城市不属于行程目的地');
    }
    plan.quote.options = plan.hotelPlans
      .filter((p) => p.hotels.length)
      .flatMap((h) =>
        plan.vehiclePlans
          .filter((p) => p.arrangements.length)
          .map((v) => {
            const option = options.find(
              (o) => o.hotelTier === h.tier && o.vehicleTier === v.tier,
            );
            return {
              id: option?.id ?? randomUUID(),
              hotelTier: h.tier,
              vehicleTier: v.tier,
              guideServiceTotal:
                option?.guideServiceTotal == null
                  ? null
                  : roundMoney(option.guideServiceTotal),
              staffRoomCosts: plan.destinations.map((destination) => {
                const total = option?.staffRoomCosts.find(
                  (cost) => cost.destination === destination,
                )?.total;
                return {
                  destination,
                  total: total == null ? null : roundMoney(total),
                };
              }),
              paxPrices: plan.paxTiers.map((pax) => {
                const price = option?.paxPrices.find(
                  (price) => price.pax === pax,
                )?.adultUnitPrice;
                return {
                  pax,
                  adultUnitPrice: price == null ? null : roundMoney(price),
                };
              }),
            };
          }),
      );
    for (const fee of plan.quote.transportFees) {
      if (
        !(
          fee.type === 'flight' ? ['economy', 'business'] : ['first', 'second']
        ).includes(fee.cabin)
      )
        invalid('Invalid transport cabin');
      fee.unitPrice ??= null;
    }
    plan.quote.chineseTip ??= null;
    plan.quote.englishTip ??= null;
    if (plan.quote.chineseTip !== null && plan.quote.englishTip !== null)
      invalid('中文和第二语言小费只能填写一种');
    return plan;
  }
  assertPdfReady(plan: ItineraryInput, plannedDays = plan.dailyPlans.length) {
    const issues: string[] = [];
    const hotels = plan.hotelPlans.filter((p) => p.hotels.length);
    if (
      !hotels.length ||
      !plan.vehiclePlans.some(
        (p) => p.arrangements.length && p.totalPrice !== null,
      ) ||
      !plan.quote.options.length
    )
      issues.push('hotelVehicleQuote');
    for (const vehicle of plan.vehiclePlans)
      if (
        vehicle.arrangements.length &&
        (vehicle.totalPrice === null ||
          vehicle.arrangements.some(
            (a) => !a.startDate || !a.endDate || !a.vehicles.length,
          ))
      )
        issues.push('vehicleDays');
    const itineraryEndDate = dateAt(plan.startDate, plannedDays - 1);
    for (const vehicle of plan.vehiclePlans) {
      const sortedRanges = [...vehicle.arrangements].sort((a, b) =>
        a.startDate.localeCompare(b.startDate),
      );
      if (
        sortedRanges.some(
          (range, index) =>
            !isCalendarDate(range.startDate) ||
            !isCalendarDate(range.endDate) ||
            range.startDate < plan.startDate ||
            range.endDate > itineraryEndDate ||
            range.startDate > range.endDate ||
            (index > 0 && range.startDate <= sortedRanges[index - 1].endDate),
        )
      )
        issues.push('vehicleDays');
    }
    for (const day of plan.dailyPlans) {
      if (!day.description?.trim() || day.overnightDestination === null)
        issues.push(`dailyPlans[${day.id}]`);
      if (
        day.overnightDestination &&
        hotels.some(
          (p) =>
            !p.hotels.some((h) => h.destination === day.overnightDestination),
        )
      )
        issues.push(`hotelPlans[${day.overnightDestination}]`);
      for (const slot of ['lunch', 'dinner'] as const)
        if (
          day.meals[slot] &&
          !day.items.some((i) => i.type === 'restaurant' && i.mealSlot === slot)
        )
          issues.push(`dailyPlans[${day.id}].${slot}`);
    }
    for (const g of plan.guidePlans)
      if (!g.serviceDays) issues.push(`guidePlans[${g.destination}]`);
    for (const fee of plan.quote.transportFees)
      if (
        !fee.departureCity ||
        !fee.arrivalCity ||
        fee.departureCity === fee.arrivalCity ||
        fee.unitPrice === null
      )
        issues.push(`transportFees[${fee.id}]`);
    if (issues.length)
      throw new BusinessException({
        code: 'PDF_NOT_READY',
        message: 'Complete the itinerary before generating PDF',
        status: HttpStatus.BAD_REQUEST,
        details: { issues },
      });
  }
}

export async function assertItineraryLibrary(
  manager: EntityManager,
  plan: ItineraryInput,
  library: ResourceLibrary,
) {
  const references = [
    {
      entity: HotelEntity,
      ids: plan.hotelPlans.flatMap((p) => p.hotels.map((h) => h.hotelId)),
    },
    { entity: GuideEntity, ids: plan.guidePlans.map((g) => g.guideId) },
    {
      entity: TransportEntity,
      ids: plan.vehiclePlans.flatMap((p) =>
        p.arrangements.flatMap((a) => a.vehicles.map((v) => v.vehicleId)),
      ),
    },
  ];
  for (const reference of references) {
    const ids = [...new Set(reference.ids)];
    if (!ids.length) continue;
    const rows = await manager
      .getRepository(reference.entity)
      .find({ where: { id: In(ids), library }, withDeleted: true });
    if (rows.length !== ids.length) invalid('Resource outside inquiry library');
  }
  for (const item of plan.dailyPlans.flatMap((d) => d.items)) {
    if (item.resourceId === null && item.type === 'restaurant') continue;
    const kind = item.type === 'restaurant' ? 'restaurants' : 'attractions';
    const parent = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM resource_${kind} WHERE id=$1 AND library=$2`,
      [item.resourceId, library],
    );
    if (!parent.length) invalid('Resource outside inquiry library');
  }
}
