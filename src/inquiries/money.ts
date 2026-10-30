/** Keep monetary rules synchronized with sunrise-travel-ops-web/src/utils/money.ts. */
/** Monetary values round half away from zero; ratios are evaluated without binary float intermediates. */
const CENTS_PER_UNIT = 100;

function fraction(value: number): [bigint, bigint] {
  if (!Number.isFinite(value))
    throw new TypeError('Money must be a finite number');
  const [decimal = '0', exponent = '0'] = String(value)
    .toLowerCase()
    .split('e');
  const [integer, fractional = ''] = decimal.split('.');
  const digits = BigInt(integer + fractional);
  const scale = fractional.length - Number(exponent);
  return scale >= 0
    ? [digits, 10n ** BigInt(scale)]
    : [digits * 10n ** BigInt(-scale), 1n];
}

function roundedInteger(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) throw new RangeError('Money divisor must be positive');
  const magnitude = numerator < 0n ? -numerator : numerator;
  const rounded = (magnitude + denominator / 2n) / denominator;
  const result = Number(numerator < 0n ? -rounded : rounded);
  if (!Number.isSafeInteger(result))
    throw new RangeError('Money exceeds safe integer cents');
  return result;
}

/** Convert decimal yuan to integer cents. */
export function toCents(value: number): number {
  const [numerator, denominator] = fraction(value);
  return roundedInteger(numerator * 100n, denominator);
}

export function fromCents(value: number): number {
  return value / CENTS_PER_UNIT;
}

export function roundMoney(value: number): number {
  return fromCents(toCents(value));
}

/** Round the unit price to cents, then apply quantity/divisor with one final cent rounding. */
export function multiplyMoney(
  unitAmount: number,
  quantity: number,
  divisor = 1,
): number {
  const [numerator, denominator] = fraction(quantity);
  const [dividend, scale] = fraction(divisor);
  return fromCents(
    roundedInteger(
      BigInt(toCents(unitAmount)) * numerator * scale,
      denominator * dividend,
    ),
  );
}

export function divideMoney(amount: number, divisor: number): number {
  return multiplyMoney(amount, 1, divisor);
}

export function sumMoney(values: number[]): number {
  return fromCents(
    roundedInteger(
      values.reduce((sum, value) => sum + BigInt(toCents(value)), 0n),
      1n,
    ),
  );
}
