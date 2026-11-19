import type {
  ItineraryDayRecord,
  ItineraryHotelSelection,
} from './itinerary.types';

/**
 * Hotels are chosen per tier and per overnight day. Frozen snapshots before
 * per-day selection have no dayId and still match by overnight city.
 */
export function hotelForDay<
  T extends Pick<ItineraryHotelSelection, 'destination'> & { dayId?: string },
>(
  hotels: T[],
  day: Pick<ItineraryDayRecord, 'id' | 'overnightDestination'>,
): T | undefined {
  if (!day.overnightDestination) return undefined;
  return hotels.find((hotel) =>
    hotel.dayId
      ? hotel.dayId === day.id
      : hotel.destination === day.overnightDestination,
  );
}
