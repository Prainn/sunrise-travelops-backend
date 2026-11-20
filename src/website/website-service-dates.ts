import { addDays } from '../tours/tour-rules';
import type { WebsiteItineraryInput } from './website.types';

type Calendar = Pick<WebsiteItineraryInput, 'startDate' | 'serviceDates'>;

/** dayNumber indexes the saved itinerary calendar, including after the inquiry is rescheduled. */
export function websiteDayDate(
  calendar: Calendar,
  dayNumber: number,
): string | null {
  if (calendar.serviceDates)
    return calendar.serviceDates[dayNumber - 1] ?? null;
  return calendar.startDate ? addDays(calendar.startDate, dayNumber - 1) : null;
}

export function consecutiveServiceDays(
  dates: string[] | null | undefined,
  dayNumber: number,
): boolean {
  if (!dates) return true;
  const previous = dates[dayNumber - 2];
  return !!previous && addDays(previous, 1) === dates[dayNumber - 1];
}

export function sameServiceDates(
  left?: string[] | null,
  right?: string[] | null,
): boolean {
  if (!left || !right) return !left && !right;
  return (
    left.length === right.length && left.every((date, i) => date === right[i])
  );
}
