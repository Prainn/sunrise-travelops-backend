const CENTS_PER_UNIT = 100;

/** 将以元表示的金额转换为整数分。 */
export function toCents(value: number): number {
  if (!Number.isFinite(value))
    throw new TypeError('Money must be a finite number');
  const correction = value >= 0 ? Number.EPSILON : -Number.EPSILON;
  return Math.round((value + correction) * CENTS_PER_UNIT);
}

/** 将整数分转换为以元表示的金额。 */
export function fromCents(value: number): number {
  return value / CENTS_PER_UNIT;
}

/** 将金额按分四舍五入。 */
export function roundMoney(value: number): number {
  return fromCents(toCents(value));
}

/** 使用整数分计算单价和数量的乘积。 */
export function multiplyMoney(unitAmount: number, quantity: number): number {
  return fromCents(Math.round(toCents(unitAmount) * quantity));
}

/** 使用整数分汇总金额。 */
export function sumMoney(values: number[]): number {
  return fromCents(values.reduce((total, value) => total + toCents(value), 0));
}
