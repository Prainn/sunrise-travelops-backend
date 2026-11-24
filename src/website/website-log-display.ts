import type {
  WebsiteLogChange,
  WebsiteLogDisplayChange,
  WebsiteLogReference,
} from './website.types';

export type LogSide = 'before' | 'after';
export type RefKind = WebsiteLogReference['ref'];
export type NameBook = Record<string, WebsiteLogReference>;
export interface LogNames {
  before: NameBook;
  after: NameBook;
  // An empty or partial eventOrder is completed from that side's saved day.
  orders?: Record<string, { before: string[]; after: string[] }>;
}
export type Lookup = (
  side: LogSide,
  kind: RefKind,
  id: string,
) => WebsiteLogReference;
export const blankNames = (): LogNames => ({ before: {}, after: {} });
export const objectValue = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
export const stringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((entry) => typeof entry === 'string');

const refFields: Record<string, RefKind> = {
  countryItemId: 'country',
  ownerId: 'owner',
  destinations: 'city',
  cityId: 'city',
  departCityId: 'city',
  endCityId: 'city',
  overnightCityId: 'city',
  viaCityIds: 'city',
  fromCityId: 'city',
  toCityId: 'city',
  attractionId: 'attraction',
  routeId: 'route',
  configHotelId: 'configHotel',
  eventOrder: 'event',
  dayIds: 'day',
  addedDayIds: 'day',
  dayId: 'day',
  itemIds: 'event',
  removedItemIds: 'event',
  sourceId: 'event',
  parentId: 'event',
};
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const priceKey =
  /^(vehiclePrices|nightlyVehiclePrices)\.(\[(?:"(?:\\.|[^"\\])*"|null),(?:"(?:\\.|[^"\\])*"|null)\]|"(?:\\.|[^"\\])*"|null)(?:\.|$)/;

function displayPath(change: WebsiteLogChange) {
  const { path } = change;
  const price = priceKey.exec(path);
  const context = { ...change.context };
  if (price) {
    const combo: unknown = JSON.parse(price[2]);
    const vehicle: unknown = Array.isArray(combo) ? combo[0] : combo;
    if (typeof vehicle === 'string') context.vehicleType = vehicle;
    // Historical A/B plans have their own plan field. Only the original
    // logged hotelTier context identifies a combination's tier unambiguously.
    const tail = path.slice(price[0].length);
    return { fields: [price[1], ...tail.split('.').filter(Boolean)], context };
  }
  return {
    fields: path
      .replace(/\[[^\]]+\]/g, '')
      .split('.')
      .filter(Boolean),
    context,
  };
}

function priceValue(value: Record<string, unknown>, field: string): unknown[] {
  return Object.entries(value).map(([key, item]) => {
    if (field === 'priceComponents')
      return {
        category: key,
        ...(objectValue(item) ? item : { unitPrice: item }),
      };
    if (field === 'nightlyVehiclePrices') {
      let type: unknown = key;
      if (key === 'null' || /^"(?:\\.|[^"\\])*"$/.test(key))
        type = JSON.parse(key);
      return { vehicleType: type, priceComponents: item };
    }
    if (objectValue(item) && 'vehicleType' in item) return item;
    // Older groups may store the vehicle only in the key.
    const match = priceKey.exec('vehiclePrices.' + key);
    const parsed: unknown = match ? JSON.parse(match[2]) : key;
    const vehicleType: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
    return { vehicleType, ...(objectValue(item) ? item : { unitPrice: item }) };
  });
}

function displayValue(
  value: unknown,
  fields: string[],
  side: LogSide,
  lookup: Lookup,
): unknown {
  const field = fields.at(-1) ?? '';
  if (Array.isArray(value))
    return value.map((item) => displayValue(item, fields, side, lookup));
  if (objectValue(value)) {
    if (
      ['priceComponents', 'vehiclePrices', 'nightlyVehiclePrices'].includes(
        field,
      )
    ) {
      // A keyed group differs from an individual price/component record.
      if (!(
        'unitPrice' in value ||
        'category' in value ||
        'vehicleType' in value ||
        'showInPdf' in value
      ))
        return priceValue(value, field).map((item) =>
          displayValue(item, [...fields, 'entry'], side, lookup),
        );
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'id')
        .map(([key, item]) => [
          key,
          displayValue(item, [...fields, key], side, lookup),
        ]),
    );
  }
  if (typeof value !== 'string' || value === '') return value;
  if (field === 'destinations' && !uuid.test(value)) return value;
  let kind = refFields[field];
  if (field === 'order')
    kind = ['days', 'deletedDays', 'placements', 'overnight'].includes(
      fields.at(-2) ?? '',
    )
      ? 'day'
      : 'event';
  if (field === 'resourceId')
    kind = fields.includes('meals') ? 'restaurant' : 'sharedHotel';
  return kind ? lookup(side, kind, value) : value;
}

const sameOrder = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
function commonOrderChanged(a: string[], b: string[]): boolean {
  const left = new Set(a),
    right = new Set(b);
  return !sameOrder(
    a.filter((id) => right.has(id)),
    b.filter((id) => left.has(id)),
  );
}

/** Produce the readable view. Keep the original audit and its report count intact. */
export function displayLogChanges(
  changes: WebsiteLogChange[],
  lookup: Lookup,
  orders: LogNames['orders'] = {},
) {
  const paths = new Set(changes.map((change) => change.path));
  const visibleOrders = new Map<
    string,
    { before: string[]; after: string[] }
  >();
  for (const c of changes) {
    if (
      !c.path.endsWith('.eventOrder') ||
      !stringList(c.before) ||
      !stringList(c.after)
    )
      continue;
    const actual = orders[c.path] ?? { before: c.before, after: c.after };
    if (commonOrderChanged(actual.before, actual.after))
      visibleOrders.set(c.path, actual);
  }
  const result: WebsiteLogDisplayChange[] = [];
  for (const c of changes) {
    if (
      (c.path === 'owner' && paths.has('ownerId')) ||
      (['countryCode', 'countryOrRegion'].includes(c.path) &&
        paths.has('countryItemId'))
    )
      continue;
    const { fields, context } = displayPath(c);
    const parentOrder = c.path.replace(
      /\.(items|legs|hotels|meals|services)\.order$/,
      '.eventOrder',
    );
    const sorted = visibleOrders.get(parentOrder);
    if (
      parentOrder !== c.path &&
      sorted &&
      stringList(c.before) &&
      stringList(c.after)
    ) {
      const old = new Set(c.before),
        next = new Set(c.after);
      if (
        sameOrder(
          sorted.before.filter((id) => old.has(id)),
          c.before,
        ) &&
        sameOrder(
          sorted.after.filter((id) => next.has(id)),
          c.after,
        )
      )
        continue;
    }
    let { before, after } = c;
    if (
      c.path.endsWith('.eventOrder') &&
      stringList(before) &&
      stringList(after)
    ) {
      if (!sorted) continue;
      ({ before, after } = sorted);
    }
    result.push({
      fields,
      kind: c.kind,
      ...(Object.keys(context).length ? { context } : {}),
      before: displayValue(before, fields, 'before', lookup),
      after: displayValue(after, fields, 'after', lookup),
    });
  }
  return result;
}

export function renderLogNames(changes: WebsiteLogChange[], names: LogNames) {
  return displayLogChanges(
    changes,
    (side, kind, id) =>
      names[side][kind + ':' + id] ?? {
        ref: kind === 'event' && id.endsWith('-guide') ? 'guide' : kind,
      },
    names.orders,
  );
}
