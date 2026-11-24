import type { WebsiteLogChange, WebsiteLogReference } from './website.types';
import {
  blankNames,
  displayLogChanges,
  objectValue,
  stringList,
} from './website-log-display';
import type {
  LogNames,
  LogSide,
  NameBook,
  RefKind,
} from './website-log-display';

type RecordValue = Record<string, unknown>;
const records = (rows: unknown) =>
  Array.isArray(rows) ? rows.filter(objectValue) : [];
const text = (value: unknown) =>
  typeof value === 'string' && value ? value : undefined;
const num = (value: unknown) => (typeof value === 'number' ? value : undefined);
const groups = {
  items: 'item',
  legs: 'leg',
  hotels: 'hotel',
  meals: 'meal',
  services: 'service',
} as const;
const evidenceFields = new Set([
  'days',
  'deletedDays',
  'reorderDraft',
  'configVersion',
  'owner',
  'ownerId',
  'countryItemId',
  'countryCode',
  'countryOrRegion',
]);

export interface CatalogRequest {
  side: LogSide;
  kind: RefKind;
  id: string;
  version?: number;
}
export interface NameCapture {
  names: LogNames;
  requests: CatalogRequest[];
}

function sideIndex(state: RecordValue) {
  const book: NameBook = {};
  const orders = new Map<string, string[]>();
  const ambiguous = new Set<string>();
  function put(kind: RefKind, id: unknown, value: WebsiteLogReference) {
    if (typeof id === 'string' && id) book[kind + ':' + id] = value;
  }
  // An editable entry's saved wording is distinct from a catalogue name.
  // Conflicting entry texts for one reference cannot identify a unique name.
  function linked(
    kind: RefKind,
    id: unknown,
    nameZh?: string,
    nameEn?: string,
  ) {
    if (typeof id !== 'string' || !id || (!nameZh && !nameEn)) return;
    const key = kind + ':' + id;
    if (ambiguous.has(key)) return;
    const previous = book[key];
    if (
      previous &&
      (previous.nameZh !== nameZh || previous.nameEn !== nameEn)
    ) {
      delete book[key];
      ambiguous.add(key);
      return;
    }
    put(kind, id, { ref: kind, nameZh, nameEn, source: 'entry' });
  }
  function event(row: RecordValue, ref: WebsiteLogReference['ref']) {
    const nameZh = text(row.nameZh) ?? text(row.restaurantZh),
      nameEn = text(row.nameEn) ?? text(row.restaurantEn);
    put('event', row.id, {
      ref,
      nameZh,
      nameEn,
      mode: text(row.mode),
      hotelTier: text(row.tier),
      mealSlot: text(row.slot),
    });
    linked('attraction', row.attractionId, nameZh, nameEn);
    linked('route', row.routeId, nameZh, nameEn);
    linked('configHotel', row.configHotelId, nameZh, nameEn);
    if (ref === 'meal' || ref === 'hotel')
      linked(
        ref === 'meal' ? 'restaurant' : 'sharedHotel',
        row.resourceId,
        nameZh,
        nameEn,
      );
  }
  function day(row: RecordValue, root: string) {
    if (typeof row.id !== 'string') return;
    put('day', row.id, { ref: 'day', dayNumber: num(row.dayNumber) });
    for (const [key, kind] of Object.entries(groups))
      for (const item of records(row[key])) event(item, kind);
    const guide = row.id + '-guide';
    if (row.guideLanguage)
      put('event', guide, { ref: 'guide', nameZh: text(row.guideLanguage) });
    if (
      !Object.keys(groups).every((key) => Array.isArray(row[key])) ||
      !('guideLanguage' in row)
    )
      return;
    const ids = (key: string) =>
      records(row[key]).flatMap((v) =>
        typeof v.id === 'string' ? [v.id] : [],
      );
    const remaining = new Set([
      ...ids('items'),
      ...ids('legs'),
      ...ids('hotels'),
      ...ids('meals'),
      ...(row.guideLanguage ? [guide] : []),
      ...ids('services'),
    ]);
    const explicit = stringList(row.eventOrder) ? row.eventOrder : [];
    if (explicit.some((id) => !remaining.has(id))) return;
    orders.set(root + '.eventOrder', [
      ...explicit.filter((id) => remaining.delete(id)),
      ...remaining,
    ]);
  }
  for (const row of records(state.days))
    day(row, 'days[' + String(row.id) + ']');
  for (const entry of records(state.deletedDays))
    if (objectValue(entry.day))
      day(entry.day, 'deletedDays[' + String(entry.day.id) + '].day');
  if (objectValue(state.reorderDraft)) {
    const draft = state.reorderDraft;
    for (const row of records(draft.deletedDays))
      if (!book['day:' + String(row.id)])
        put('day', row.id, { ref: 'day', dayNumber: num(row.dayNumber) });
    for (const [i, id] of (stringList(draft.dayIds)
      ? draft.dayIds
      : []
    ).entries())
      if (!book['day:' + id]) put('day', id, { ref: 'day', dayNumber: i + 1 });
    for (const row of records(draft.transportCopies)) event(row, 'leg');
    for (const row of records(draft.copies)) {
      const source = book['event:' + String(row.sourceId)];
      if (source) put('event', row.id, source);
    }
  }
  put('owner', state.ownerId, { ref: 'owner', nameZh: text(state.owner) });
  put('country', state.countryItemId, {
    ref: 'country',
    nameZh: text(state.countryOrRegion),
    code: text(state.countryCode),
  });
  return { book, orders, version: num(state.configVersion) };
}

const external = new Set<RefKind>([
  'city',
  'attraction',
  'route',
  'configHotel',
  'sharedHotel',
  'restaurant',
]);
export function captureNames(
  changes: WebsiteLogChange[],
  before: ReturnType<typeof sideIndex>,
  after: ReturnType<typeof sideIndex>,
): NameCapture {
  const names = blankNames(),
    requests: CatalogRequest[] = [];
  const sides = { before, after };
  for (const c of changes) {
    if (
      !c.path.endsWith('.eventOrder') ||
      !stringList(c.before) ||
      !stringList(c.after)
    )
      continue;
    const old = before.orders.get(c.path) ?? c.before,
      next = after.orders.get(c.path) ?? c.after;
    if (
      JSON.stringify(old) !== JSON.stringify(c.before) ||
      JSON.stringify(next) !== JSON.stringify(c.after)
    )
      (names.orders ??= {})[c.path] = { before: old, after: next };
  }
  displayLogChanges(
    changes,
    (side, kind, id) => {
      const key = kind + ':' + id;
      if (!names[side][key]) {
        names[side][key] = sides[side].book[key] ?? {
          ref: kind === 'event' && id.endsWith('-guide') ? 'guide' : kind,
        };
        if (external.has(kind))
          requests.push({ side, kind, id, version: sides[side].version });
      }
      return names[side][key];
    },
    names.orders,
  );
  return { names, requests };
}

export function targetNames(
  changes: WebsiteLogChange[],
  before: object | undefined,
  after: object,
) {
  return captureNames(
    changes,
    sideIndex({ ...before }),
    sideIndex({ ...after }),
  );
}

function rowId(row: RecordValue): unknown {
  return row.id ?? (objectValue(row.day) ? row.day.id : undefined);
}

/** Replay only logged evidence, including the before side of an incomplete history. */
function applySide(
  state: RecordValue,
  changes: WebsiteLogChange[],
  side: LogSide,
) {
  for (const change of changes) {
    const segments = change.path.split('.');
    if (!evidenceFields.has(segments[0].split('[')[0])) continue;
    const remove =
      side === 'before' ? change.kind === 'added' : change.kind === 'removed';
    let node = state;
    for (const [i, part] of segments.entries()) {
      const keyed = /^(\w+)\[([^\]]+)\]$/.exec(part);
      const last = i === segments.length - 1;
      if (keyed) {
        const [, key, id] = keyed;
        const rows = records(node[key]);
        node[key] = rows;
        const index = rows.findIndex((row) => rowId(row) === id);
        if (last) {
          if (index >= 0) rows.splice(index, 1);
          const item = change[side];
          if (!remove && objectValue(item))
            rows.splice(
              index >= 0 ? index : rows.length,
              0,
              structuredClone(item),
            );
          break;
        }
        if (index < 0) rows.push({ id });
        node = rows[index < 0 ? rows.length - 1 : index];
        // The original writer chooses the after item's context on an edit.
        // Use that evidence only on its own side, never to populate an earlier name.
        if (side === 'after' && !remove && change.context) {
          const ctx = change.context;
          if (key === 'days') node.dayNumber ??= ctx.dayNumber;
          if (Object.hasOwn(groups, key)) {
            node[key === 'meals' ? 'restaurantZh' : 'nameZh'] ??= ctx.nameZh;
            node[key === 'meals' ? 'restaurantEn' : 'nameEn'] ??= ctx.nameEn;
            if (key === 'hotels') node.tier ??= ctx.hotelTier;
            if (key === 'meals') node.slot ??= ctx.mealSlot;
          }
        }
      } else if (last) {
        if (remove) delete node[part];
        else node[part] = structuredClone(change[side]);
      } else if (segments[i + 1] === 'order' && Array.isArray(node[part])) {
        const order = change[side];
        if (stringList(order)) {
          const rows = records(node[part]);
          const byId = new Map(rows.map((row) => [rowId(row), row]));
          const listed = new Set(order);
          node[part] = [
            ...order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
            ...rows.filter((row) => !listed.has(String(rowId(row)))),
          ];
        }
        break;
      } else {
        if (!objectValue(node[part])) node[part] = {};
        node = node[part] as RecordValue;
      }
    }
  }
}

export function replayLog(
  state: RecordValue,
  changes: WebsiteLogChange[],
  capture: boolean,
) {
  if (!capture) {
    applySide(state, changes, 'after');
    return;
  }
  applySide(state, changes, 'before');
  const before = sideIndex(state);
  applySide(state, changes, 'after');
  return captureNames(changes, before, sideIndex(state));
}
