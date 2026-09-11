import { diffChanges, moneyResponse } from './changes';
describe('persisted field changes', () => {
  it('identifies added/deleted days separately from reordered days and item price changes', () => {
    const before = {
      dailyPlans: [
        { id: 'a', items: [{ id: 'meal', quantity: 2, unitCost: 20 }] },
        { id: 'b', items: [] },
        { id: 'deleted', items: [] },
      ],
    };
    const after = {
      dailyPlans: [
        { id: 'b', items: [] },
        { id: 'a', items: [{ id: 'meal', quantity: 3, unitCost: 25 }] },
        { id: 'new', items: [] },
      ],
    };
    expect(diffChanges(before, after)).toEqual(
      expect.arrayContaining([
        {
          path: 'dailyPlans[a].items[meal].quantity',
          kind: 'changed',
          before: 2,
          after: 3,
        },
        {
          path: 'dailyPlans[a].items[meal].unitCost',
          kind: 'changed',
          before: 20,
          after: 25,
        },
        {
          path: 'dailyPlans[deleted]',
          kind: 'removed',
          before: { id: 'deleted', items: [] },
          after: null,
        },
        {
          path: 'dailyPlans[new]',
          kind: 'added',
          before: null,
          after: { id: 'new', items: [] },
        },
        {
          path: 'dailyPlans.order',
          kind: 'changed',
          before: ['a', 'b', 'deleted'],
          after: ['b', 'a', 'new'],
        },
      ]),
    );
  });
  it('does not log a no-op or confuse null and zero', () => {
    expect(diffChanges({ price: 0 }, { price: 0 })).toEqual([]);
    expect(diffChanges(null, 0, 'price')).toEqual([
      { path: 'price', kind: 'changed', before: null, after: 0 },
    ]);
  });
  it('serializes money without changing counts', () => {
    expect(
      moneyResponse({
        guideCost: 20,
        options: [{ adultUnitPrice: 3, quantity: 2 }],
      }),
    ).toEqual({
      guideCost: '20.00',
      options: [{ adultUnitPrice: '3.00', quantity: 2 }],
    });
  });
});

it('ignores JSONB object key order inside vehicle arrays but detects real changes', () => {
  const before = {
    vehiclePlans: [
      {
        tier: 'standard',
        arrangements: [
          {
            id: 'segment',
            vehicles: [
              {
                seats: 19,
                quantity: 1,
                vehicleId: 'bus',
                vehicleName: 'Coach',
              },
            ],
          },
        ],
      },
    ],
  };
  const after = {
    vehiclePlans: [
      {
        tier: 'standard',
        arrangements: [
          {
            id: 'segment',
            vehicles: [
              {
                vehicleId: 'bus',
                vehicleName: 'Coach',
                seats: 19,
                quantity: 1,
              },
            ],
          },
        ],
      },
    ],
  };
  expect(diffChanges(before, after)).toEqual([]);
  after.vehiclePlans[0].arrangements[0].vehicles[0].quantity = 2;
  expect(diffChanges(before, after)).toHaveLength(1);
  after.vehiclePlans[0].arrangements[0].vehicles = [];
  expect(diffChanges(before, after)).toHaveLength(1);
});
