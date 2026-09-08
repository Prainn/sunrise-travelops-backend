import type { FieldChange } from './inquiry.entity';
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function key(value: unknown): string | undefined {
  if (!object(value)) return undefined;
  const id = value.id ?? value.tier ?? value.destination;
  return typeof id === 'string' ? id : undefined;
}
/** Compare persisted versions; identify collection members by stable IDs rather than row positions. */
export function diffChanges(
  before: unknown,
  after: unknown,
  path = '',
): FieldChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
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
  'unitCost',
  'referenceUnitCost',
  'totalCost',
  'dailyPrice',
  'adultUnitPrice',
  'unitPrice',
  'chineseTip',
  'englishTip',
  'childUnitPrice',
  'hotelCost',
  'vehicleCost',
  'commonGroupCost',
  'baseGroupCost',
  'baseCostPerPerson',
  'singleSupplementUnitCost',
  'totalPrice',
  'profit',
  'dailyResourceCost',
  'guideCost',
]);
export function moneyResponse(value: unknown, field = ''): unknown {
  if (typeof value === 'number' && MONEY_FIELDS.has(field))
    return value.toFixed(2);
  if (Array.isArray(value)) return value.map((item) => moneyResponse(item));
  if (object(value))
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        moneyResponse(item, name),
      ]),
    );
  return value;
}

/** Add display context without changing the stable audit path or its stored values. */
export function contextualChanges(
  before: unknown,
  after: unknown,
): FieldChange[] {
  const readArray = (value: unknown, name: string): unknown[] =>
    object(value) && Array.isArray(value[name])
      ? (value[name] as unknown[])
      : [];
  const find = (name: string, id: string) =>
    [...readArray(after, name), ...readArray(before, name)].find(
      (item) => key(item) === id,
    );
  return diffChanges(before, after).map((change) => {
    const context: NonNullable<FieldChange['context']> = {};
    const dayId = change.path.match(/dailyPlans\[([^\]]+)\]/)?.[1];
    if (dayId) {
      const day = find('dailyPlans', dayId);
      if (object(day) && typeof day.dayNumber === 'number')
        context.dayNumber = day.dayNumber;
      const itemId = change.path.match(/items\[([^\]]+)\]/)?.[1];
      const item = itemId
        ? readArray(day, 'items').find((item) => key(item) === itemId)
        : undefined;
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
    if (object(after) && object(after.quote)) {
      const optionId = change.path.match(/options\[([^\]]+)\]/)?.[1];
      const option = readArray(after.quote, 'options').find(
        (item) => key(item) === optionId,
      );
      if (object(option)) {
        context.hotelTier = String(option.hotelTier);
        context.vehicleTier = String(option.vehicleTier);
      }
    }
    return { ...change, context };
  });
}
