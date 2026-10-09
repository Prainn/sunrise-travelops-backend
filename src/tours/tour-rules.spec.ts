import {
  intervalsOverlap,
  pickTourNumber,
  ratingStats,
  tourNumberBase,
  tourSchedule,
} from './tour-rules';

describe('tourSchedule', () => {
  it('uses S+N and subtracts three hours', () => {
    expect(tourSchedule('2026-08-01', 10, '12:20', '15:20')).toMatchObject({
      pickupAt: '2026-08-01 12:20',
      dropAt: '2026-08-11 12:20',
      occupyTo: '2026-08-11',
    });
  });
  it('crosses back over midnight', () => {
    expect(tourSchedule('2026-08-01', 10, '08:00', '02:30').dropAt).toBe(
      '2026-08-10 23:30',
    );
  });
  it('crosses month and year boundaries', () => {
    expect(tourSchedule('2026-12-25', 7, '09:00', '01:00').dropAt).toBe(
      '2026-12-31 22:00',
    );
    expect(tourSchedule('2026-12-31', 1, '09:00', '05:00').dropAt).toBe(
      '2027-01-01 02:00',
    );
  });
  it('rejects invalid dates', () => {
    expect(() => tourSchedule('2026-02-30', 1, '09:00', '10:00')).toThrow();
  });
});

describe('tour number', () => {
  const base = tourNumberBase('YNSS', '2026-09-05', 'AS', 'MYS');
  it('formats and avoids collisions without recycling', () => {
    expect(pickTourNumber(base, 1, new Set())).toBe('YNSS-260905AS1-MYS');
    expect(pickTourNumber(base, 1, new Set(['YNSS-260905AS1-MYS']))).toBe(
      'YNSS-260905AS(1)1-MYS',
    );
    expect(
      pickTourNumber(
        base,
        1,
        new Set(['YNSS-260905AS1-MYS', 'YNSS-260905AS(1)1-MYS']),
      ),
    ).toBe('YNSS-260905AS(2)1-MYS');
  });
});

describe('intervalsOverlap', () => {
  it('treats both ends as inclusive', () => {
    expect(
      intervalsOverlap('2026-08-01', '2026-08-05', '2026-08-05', '2026-08-09'),
    ).toBe(true);
    expect(
      intervalsOverlap('2026-08-01', '2026-08-05', '2026-08-06', '2026-08-09'),
    ).toBe(false);
  });
});

describe('ratingStats', () => {
  it('does not treat blanks as zero but keeps real zero', () => {
    expect(ratingStats({ selfScore: 80, managerScore: null })).toMatchObject({
      average: 80,
      min: 80,
    });
    expect(ratingStats({ selfScore: 0, managerScore: 90 }).average).toBe(45);
    expect(ratingStats({}).total).toBeNull();
    expect(
      ratingStats({
        selfScore: null,
        managerScore: null,
        collectScore: null,
        operatorScore: null,
      }),
    ).toEqual({ max: null, min: null, average: null, total: null });
  });
  it('adds bonuses to the average and rounds to two decimals', () => {
    expect(
      ratingStats({
        selfScore: 90,
        managerScore: 91,
        collectScore: 92,
        carPurchase: 1.5,
        praise: 2,
      }),
    ).toEqual({ max: 92, min: 90, average: 91, total: 94.5 });
  });
  it('rejects bad values and totals above 100', () => {
    expect(() => ratingStats({ selfScore: Number.NaN })).toThrow();
    expect(() => ratingStats({ praise: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => ratingStats({ praise: 101 })).toThrow();
    expect(() =>
      ratingStats({
        selfScore: 100,
        managerScore: 100,
        collectScore: 100,
        operatorScore: 100,
        incident: 0.01,
      }),
    ).toThrow();
    expect(() => ratingStats({ selfScore: 100.001 })).toThrow();
    expect(() => ratingStats({ selfScore: 101 })).toThrow();
    expect(() => ratingStats({ selfScore: 90, praise: -1 })).toThrow();
    expect(() => ratingStats({ selfScore: 100, praise: 0.01 })).toThrow();
    expect(() => ratingStats({ selfScore: 99, praise: 1 })).not.toThrow();
  });
});
