import { isDeepStrictEqual } from 'node:util';
import type { FieldChange } from './inquiry.entity';
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function key(value: unknown): string | undefined {
  if (!object(value)) return undefined;
  const id =
    value.id ??
    value.tier ??
    value.destination ??
    (typeof value.pax === 'number' ? String(value.pax) : undefined);
  return typeof id === 'string' ? id : undefined;
}
/** Compare persisted versions; identify collection members by stable IDs rather than row positions. */
export function diffChanges(
  before: unknown,
  after: unknown,
  path = '',
): FieldChange[] {
  if (isDeepStrictEqual(before, after)) return [];
  if (before === undefined || after === undefined)
    return [
      {
        path,
        kind: before === undefined ? 'added' : 'removed',
        before: before ?? null,
        after: after ?? null,
      },
    ];
  if (Array.isArray(before) && Array.isArray(after)) {
    if (
      [...(before as unknown[]), ...(after as unknown[])].every(
        (item) => key(item) !== undefined,
      )
    ) {
      const old = new Map(before.map((item) => [key(item)!, item]));
      const next = new Map(after.map((item) => [key(item)!, item]));
      const changes = [...new Set([...old.keys(), ...next.keys()])].flatMap(
        (id) => diffChanges(old.get(id), next.get(id), `${path}[${id}]`),
      );
      const oldOrder = before.map(key).filter((id) => next.has(id!));
      const newOrder = after.map(key).filter((id) => old.has(id!));
      if (JSON.stringify(oldOrder) !== JSON.stringify(newOrder))
        changes.push({
          path: `${path}.order`,
          kind: 'changed',
          before: before.map(key),
          after: after.map(key),
        });
      return changes;
    }
    // DTO instances and persisted plain objects carry the same audit content.
    if (isDeepStrictEqual(before, after)) return [];
    return [{ path, kind: 'changed', before, after }];
  }
  if (object(before) && object(after))
    return [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].flatMap((name) =>
      diffChanges(before[name], after[name], path ? `${path}.${name}` : name),
    );
  return [{ path, kind: 'changed', before, after }];
}
const MONEY_FIELDS = new Set([
  'hotelUnitCost',
  'vehicleTotal',
  'guideServiceTotal',
  'staffRoomTotal',
  'total',
  'vehicleUnitCost',
  'guideServiceUnitCost',
  'staffRoomUnitCost',
  'leaderUnitPrice',
  'tipUnitPrice',
  'profitPerPerson',
  'referencePrice',
  'segmentTotal',
  'beforePrice',
  'afterPrice',
  'unitCost',
  'referenceUnitCost',
  'totalCost',
  'dailyPrice',
  'adultUnitPrice',
  'unitPrice',
  'chineseTip',
  'englishTip',
  'childUnitPrice',
  'childWithoutBedUnitPrice',
  'hotelCost',
  'vehicleCost',
  'commonGroupCost',
  'baseGroupCost',
  'baseCostPerPerson',
  'singleSupplementUnitCost',
  'totalPrice',
  'profit',
  'dailyResourceCost',
  'mealOtherCost',
  'attractionOtherCost',
  'guideOtherCost',
  'staffRoomOtherCost',
  'mealCost',
  'attractionCost',
  'guideCost',
]);
export function moneyResponse(value: unknown, field = ''): unknown {
  if (typeof value === 'number' && MONEY_FIELDS.has(field))
    return value.toFixed(2);
  if (Array.isArray(value)) return value.map((item) => moneyResponse(item));
  if (object(value)) {
    const changeField =
      typeof value.path === 'string' ? value.path.split('.').at(-1) : undefined;
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        moneyResponse(
          item,
          (name === 'before' || name === 'after') && changeField
            ? changeField
            : name,
        ),
      ]),
    );
  }
  return value;
}

/** Add display context without changing the stable audit path or its stored values. */
export function contextualChanges(
  before: unknown,
  after: unknown,
): FieldChange[] {
  const changes = diffChanges(before, after);
  if (!changes.length) return changes;
  const readArray = (value: unknown, name: string): unknown[] =>
    object(value) && Array.isArray(value[name])
      ? (value[name] as unknown[])
      : [];
  const index = (values: unknown[]) => {
    const map = new Map<string | undefined, unknown>();
    for (const value of values) {
      const id = key(value);
      if (!map.has(id)) map.set(id, value);
    }
    return map;
  };
  // Preserve find's first match: current days win, deleted days use the old version.
  const dayMap = index([
    ...readArray(after, 'dailyPlans'),
    ...readArray(before, 'dailyPlans'),
  ]);
  const itemMaps = new Map(
    [...dayMap].map(([id, day]) => [id, index(readArray(day, 'items'))]),
  );
  // Only current quote options supplied context before this optimization.
  const optionMap = index(
    readArray(object(after) ? after.quote : undefined, 'options'),
  );
  return changes.map((change) => {
    const context: NonNullable<FieldChange['context']> = {};
    const dayId = change.path.match(/dailyPlans\[([^\]]+)\]/)?.[1];
    if (dayId) {
      const day = dayMap.get(dayId);
      if (object(day) && typeof day.dayNumber === 'number')
        context.dayNumber = day.dayNumber;
      const itemId = change.path.match(/items\[([^\]]+)\]/)?.[1];
      const item = itemId ? itemMaps.get(dayId)?.get(itemId) : undefined;
      if (object(item) && typeof item.resourceName === 'string')
        context.name = item.resourceName;
    }
    const destination = change.path.match(
      /(?:hotels|guidePlans)\[([^\]]+)\]/,
    )?.[1];
    if (destination) context.destination = destination;
    const hotelTier = change.path.match(/hotelPlans\[([^\]]+)\]/)?.[1];
    if (hotelTier) context.hotelTier = hotelTier;
    const vehicleTier = change.path.match(/vehiclePlans\[([^\]]+)\]/)?.[1];
    if (vehicleTier) context.vehicleTier = vehicleTier;
    const optionId = change.path.match(/options\[([^\]]+)\]/)?.[1];
    const option = optionMap.get(optionId);
    if (object(option)) {
      context.hotelTier = String(option.hotelTier);
      context.vehicleTier = String(option.vehicleTier);
    }
    return { ...change, context };
  });
}
