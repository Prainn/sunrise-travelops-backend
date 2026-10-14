// Pure tour business rules: schedule times, tour numbers, occupancy, ratings.

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseDate(value: string): number {
  const m = DATE.exec(value);
  if (!m) throw new Error(`Invalid date: ${value}`);
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (new Date(ms).toISOString().slice(0, 10) !== value)
    throw new Error(`Invalid date: ${value}`);
  return ms;
}

function parseTime(value: string): number {
  const m = TIME.exec(value);
  if (!m) throw new Error(`Invalid time: ${value}`);
  return (+m[1] * 60 + +m[2]) * 60_000;
}

/** Format a UTC-based timestamp as `YYYY-MM-DD HH:mm` (no time zone). */
function stamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

export function addDays(date: string, days: number): string {
  return new Date(parseDate(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export interface TourSchedule {
  pickupAt: string;
  dropAt: string;
  occupyFrom: string;
  occupyTo: string;
}

/**
 * pickup = S + arrival time; drop = (S + N days) + departure time - 3h.
 * The full timestamp is shifted so cross-day/month/year results are exact.
 */
export function tourSchedule(
  startDate: string,
  days: number,
  arrivalTime: string,
  departureTime: string,
): TourSchedule {
  const pickup = parseDate(startDate) + parseTime(arrivalTime);
  const drop =
    parseDate(startDate) +
    days * DAY_MS +
    parseTime(departureTime) -
    3 * 3_600_000;
  return {
    pickupAt: stamp(pickup),
    dropAt: stamp(drop),
    occupyFrom: stamp(pickup).slice(0, 10),
    occupyTo: stamp(drop).slice(0, 10),
  };
}

export function tourNumberBase(
  prefix: string,
  pickupDate: string,
  creatorCode: string,
  country: string,
): { head: string; tail: string } {
  parseDate(pickupDate);
  return {
    head: `${prefix}-${pickupDate.slice(2, 4)}${pickupDate.slice(5, 7)}${pickupDate.slice(8, 10)}${creatorCode}`,
    tail: `-${country}`,
  };
}

/** Candidate k=0 is `AS1`; later candidates are `AS(1)1`, `AS(2)1`, ... */
export function tourNumberCandidate(
  base: { head: string; tail: string },
  sequence: number,
  collision: number,
): string {
  const suffix = collision === 0 ? '' : `(${collision})`;
  return `${base.head}${suffix}${sequence}${base.tail}`;
}

export function pickTourNumber(
  base: { head: string; tail: string },
  sequence: number,
  taken: ReadonlySet<string>,
): string {
  for (let k = 0; ; k += 1) {
    const candidate = tourNumberCandidate(base, sequence, k);
    if (!taken.has(candidate)) return candidate;
  }
}

/** Inclusive date intervals overlap, so a same-day drop and pickup conflict. */
export function intervalsOverlap(
  aFrom: string,
  aTo: string,
  bFrom: string,
  bTo: string,
): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

export const BASE_FIELDS = [
  'selfScore',
  'managerScore',
  'collectScore',
  'operatorScore',
] as const;
export const BONUS_FIELDS = [
  'carPurchase',
  'recommendedSelfPay',
  'praise',
  'designated',
  'incident',
] as const;
export type RatingInput = Partial<
  Record<
    (typeof BASE_FIELDS)[number] | (typeof BONUS_FIELDS)[number],
    number | null
  >
>;

/** Scores are 0..100 with at most two decimals; returns integer cents. */
export function toCents(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Score must be finite');
  const cents = Math.round(value * 100);
  if (Math.abs(cents / 100 - value) > 1e-9)
    throw new Error('Score allows at most two decimals');
  return cents;
}

export interface RatingStats {
  max: number | null;
  min: number | null;
  average: number | null;
  total: number | null;
}

const fromCents = (cents: number) => cents / 100;

/** Validates every value and derives stats; throws on rule violations. */
export function ratingStats(values: RatingInput): RatingStats {
  const base: number[] = [];
  for (const key of BASE_FIELDS) {
    const v = values[key];
    if (v == null) continue;
    const c = toCents(v);
    if (c < 0 || c > 10_000) throw new Error('Score must be within 0..100');
    base.push(c);
  }
  let bonus = 0;
  for (const key of BONUS_FIELDS) {
    const v = values[key];
    if (v == null) continue;
    const c = toCents(v);
    if (c < 0) throw new Error('Bonus must not be negative');
    bonus += c;
  }
  if (!base.length) {
    if (bonus > 10_000) throw new Error('Total must not exceed 100');
    return { max: null, min: null, average: null, total: null };
  }
  const average = Math.round(base.reduce((a, b) => a + b, 0) / base.length);
  if (average + bonus > 10_000) throw new Error('Total must not exceed 100');
  return {
    max: fromCents(Math.max(...base)),
    min: fromCents(Math.min(...base)),
    average: fromCents(average),
    total: fromCents(average + bonus),
  };
}
