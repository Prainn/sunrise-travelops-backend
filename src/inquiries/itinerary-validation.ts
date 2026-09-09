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
import { calculateItineraryQuote } from './quote-pricing';
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
  ): Promise<ItineraryInput> {
    const plan = structuredClone(input);
    const newCities = plan.destinations.filter(
      (city) => !previous?.destinations.includes(city),
    );
    if (newCities.length) {
      const cities = await manager.find(CityEntity, {
        where: { name: In(newCities) },
      });
      if (
        cities.filter((city) => city.status === ResourceStatus.Enabled)
          .length !== newCities.length
      )
        invalid('Invalid destination');
    }
    const guestCount = plan.adults + plan.childrenCount + plan.leaderCount;
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
      if (old)
        Object.assign(item, {
          resourceName: old.resourceName,
          priceName: old.priceName,
          unit: old.unit,
          unitCost: old.unitCost,
        });
      else if (item.type === 'restaurant') {
        const price = await manager.findOne(RestaurantPriceEntity, {
          where: { id: item.resourcePriceId, restaurantId: item.resourceId },
          relations: { restaurant: true },
        });
        if (
          !price?.restaurant ||
          price.restaurant.deletedAt ||
          price.restaurant.status !== ResourceStatus.Enabled
        )
          invalid('Invalid restaurant price');
        Object.assign(item, {
          resourceName: price.restaurant.name,
          priceName: price.menuName,
          unit: price.unit,
          unitCost: Number(price.price),
        });
      } else {
        const price = await manager.findOne(AttractionPriceEntity, {
          where: { id: item.resourcePriceId, attractionId: item.resourceId },
          relations: { attraction: true },
        });
        if (
          !price?.attraction ||
          price.attraction.deletedAt ||
          price.attraction.status !== ResourceStatus.Enabled
        )
          invalid('Invalid attraction price');
        Object.assign(item, {
          resourceName: price.attraction.name,
          priceName: price.itemName,
          unit: price.unit,
          unitCost: Number(price.settlementPrice),
        });
      }
      delete item.referenceUnitCost;
      item.totalCost = multiplyMoney(item.unitCost, item.quantity);
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
        if (old)
          Object.assign(selection, {
            ...old,
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
            hotel.rating !== rating
          )
            invalid('Hotel does not match city or tier');
          Object.assign(selection, {
            hotelName: hotel.name,
            rating: hotel.rating,
            breakfast: hotel.breakfast,
            unit: hotel.unit,
            unitCost: roundMoney(selection.unitCost),
          });
        }
      }
    }
    const dayIds = new Set(plan.dailyPlans.map((day) => day.id));
    for (const group of plan.vehiclePlans) {
      unique(group.arrangements.map((a) => a.id));
      group.totalPrice ??= null;
      const seatsByDay = new Map<string, number>();
      for (const arrangement of group.arrangements) {
        unique(arrangement.dayIds);
        unique(arrangement.vehicles.map((v) => v.vehicleId));
        for (const id of arrangement.dayIds)
          if (!dayIds.has(id)) invalid('Invalid vehicle date');
        for (const vehicle of arrangement.vehicles) {
          const resource = await manager.findOneBy(TransportEntity, {
            id: vehicle.vehicleId,
          });
          if (
            !resource ||
            resource.status !== ResourceStatus.Enabled ||
            resource.serviceLevel !== group.tier
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
        for (const id of arrangement.dayIds)
          seatsByDay.set(id, (seatsByDay.get(id) ?? 0) + seats);
      }
      for (const seats of seatsByDay.values())
        if (seats < guestCount) invalid('Vehicle has insufficient seats');
    }
    for (const guide of plan.guidePlans) {
      if (!plan.destinations.includes(guide.destination))
        invalid('Invalid guide destination');
      const resource = await manager.findOneBy(GuideEntity, {
        id: guide.guideId,
      });
      if (!resource || resource.status !== ResourceStatus.Enabled)
        invalid('Invalid guide');
      Object.assign(guide, {
        guideName: resource.name,
        secondLanguage: resource.secondLanguage,
        shopping: resource.shopping,
        dailyPrice: roundMoney(guide.dailyPrice),
      });
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
              adultUnitPrice:
                option?.adultUnitPrice == null
                  ? null
                  : roundMoney(option.adultUnitPrice),
              leaderFocEnabled: option?.leaderFocEnabled ?? false,
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
    return plan;
  }
  assertPdfReady(plan: ItineraryInput) {
    const issues: string[] = [];
    const costs = plan.dailyPlans
      .flatMap((d) => d.items)
      .reduce((sum, item) => sum + item.totalCost, 0);
    if (
      calculateItineraryQuote(plan, costs).options.some(
        (o) => plan.quote.otherExpenses > o.totalPrice,
      )
    )
      issues.push('otherExpenses');
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
            (a) => !a.dayIds.length || !a.vehicles.length,
          ))
      )
        issues.push('vehicleDays');
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
