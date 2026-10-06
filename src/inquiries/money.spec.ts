import {
  fromCents,
  multiplyMoney,
  roundMoney,
  sumMoney,
  toCents,
} from './money';

describe('toCents', () => {
  it.each([
    [12.34, 1234],
    [0.1 + 0.2, 30],
    [1.005, 101],
    [1.255, 126],
  ])('converts %s yuan to %s integer cents', (amount, cents) => {
    expect(toCents(amount)).toBe(cents);
  });
});

describe('fromCents', () => {
  it.each([
    [1, 0.01],
    [1234, 12.34],
    [10001, 100.01],
    [-1234, -12.34],
  ])('converts %s cents to %s yuan', (cents, amount) => {
    expect(fromCents(cents)).toBe(amount);
  });
});

describe('roundMoney', () => {
  it.each([
    [1.004, 1],
    [1.005, 1.01],
    [1.006, 1.01],
    [1.994, 1.99],
    [1.995, 2],
    [-1.005, -1.01],
  ])('rounds %s yuan to %s yuan at cent boundaries', (amount, expected) => {
    expect(roundMoney(amount)).toBe(expected);
  });
});

describe('multiplyMoney', () => {
  it.each([
    [0.1, 3, 0.3],
    [1.005, 3, 3.03],
    [19.995, 2, 40],
  ])(
    'multiplies %s yuan by %s after rounding the unit price to cents',
    (unitAmount, quantity, expected) => {
      expect(multiplyMoney(unitAmount, quantity)).toBe(expected);
    },
  );
});

describe('sumMoney', () => {
  it.each([
    { amounts: [0.1, 0.2, 0.3], expected: 0.6 },
    { amounts: Array<number>(10).fill(0.1), expected: 1 },
    { amounts: [1.005, 1.005], expected: 2.02 },
    { amounts: [12.34, -2.34, -10], expected: 0 },
  ])('sums $amounts as integer cents', ({ amounts, expected }) => {
    expect(sumMoney(amounts)).toBe(expected);
  });
});
