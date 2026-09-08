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
    const guestCount = plan.adults + plan.childrenCount;
    const guestsChanged =
      previous && guestCount !== previous.adults + previous.childrenCount;
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
        if (old && !guestsChanged) Object.assign(selection, old);
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
            breakfastIncluded: hotel.breakfastIncluded,
            breakfast: hotel.breakfast,
            unit: hotel.unit,
            unitCost: Number(
              hotel.groupPrice !== null &&
                hotel.minimumGroupSize !== null &&
                guestCount >= hotel.minimumGroupSize
                ? hotel.groupPrice
                : hotel.individualPrice,
            ),
          });
        }
      }
    }
    for (const group of plan.vehiclePlans) {
      const vehicle = group.vehicle;
      if (!vehicle) {
        group.vehicle = null;
        continue;
      }
      const old = previous?.vehiclePlans.find(
        (p) => p.tier === group.tier,
      )?.vehicle;
      if (old?.vehicleId === vehicle.vehicleId)
        Object.assign(vehicle, {
          vehicleName: old.vehicleName,
          seats: old.seats,
          referenceUnitCost: old.referenceUnitCost,
          unit: old.unit,
        });
      else {
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
          referenceUnitCost: Number(resource.dailyPrice),
          unit: resource.unit,
        });
      }
      if (vehicle.seats < guestCount) invalid('Vehicle has insufficient seats');
      vehicle.unitCost = roundMoney(vehicle.unitCost);
    }
    const assigned = new Set<string>();
    for (const guide of plan.guidePlans) {
      if (!plan.destinations.includes(guide.destination))
        invalid('Invalid guide destination');
      for (const id of guide.dayIds) {
        if (assigned.has(id) || !plan.dailyPlans.some((d) => d.id === id))
          invalid('Invalid or overlapping guide date');
        assigned.add(id);
      }
      const old = previous?.guidePlans.find(
        (g) =>
          g.destination === guide.destination && g.guideId === guide.guideId,
      );
      if (old)
        Object.assign(guide, {
          guideName: old.guideName,
          dailyPrice: old.dailyPrice,
        });
      else {
        const resource = await manager.findOneBy(GuideEntity, {
          id: guide.guideId,
        });
        if (!resource || resource.status !== ResourceStatus.Enabled)
          invalid('Invalid guide');
        Object.assign(guide, {
          guideName: resource.name,
          dailyPrice: Number(resource.dailyPrice),
        });
      }
    }
    plan.dailyPlans.forEach((day, index) => {
      const overnight = plan.dailyPlans[index - 1]?.overnightDestination;
      const hotels = plan.hotelPlans
        .filter((p) => p.hotels.length)
        .map((p) => p.hotels.find((h) => h.destination === overnight));
      day.meals.breakfast = Boolean(
        overnight && hotels.length && hotels.every((h) => h?.breakfastIncluded),
      );
    });
    const options = plan.quote.options;
    unique(options.map((o) => `${o.hotelTier}:${o.vehicleTier}`));
    plan.quote.options = plan.hotelPlans
      .filter((p) => p.hotels.length)
      .flatMap((h) =>
        plan.vehiclePlans
          .filter((p) => p.vehicle)
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
    const hotels = plan.hotelPlans.filter((p) => p.hotels.length);
    if (
      !hotels.length ||
      !plan.vehiclePlans.some((p) => p.vehicle && p.vehicle.serviceDays > 0) ||
      !plan.quote.options.length
    )
      issues.push('hotelVehicleQuote');
    for (const vehicle of plan.vehiclePlans)
      if (vehicle.vehicle && !vehicle.vehicle.serviceDays)
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
      if (!g.dayIds.length) issues.push(`guidePlans[${g.destination}]`);
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
