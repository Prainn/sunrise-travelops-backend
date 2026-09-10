import { QueryRunner } from 'typeorm';
import { MigrateVehicleArrangementDateRanges1789095600000 } from '../../src/migrations/1789095600000-MigrateVehicleArrangementDateRanges';

describe('vehicle date range upgrade', () => {
  it('preserves nonconsecutive dates, prices and frozen snapshot calculations', async () => {
    const plan = {
      startDate: '2026-09-10',
      dailyPlans: ['10', '11', '12'].map((day, index) => ({
        id: `d${index + 1}`,
        date: `2026-09-${day}`,
      })),
      vehiclePlans: [
        {
          tier: 'standard',
          totalPrice: 4000,
          arrangements: [
            {
              id: 'a',
              dayIds: ['d1', 'd3'],
              totalPrice: 1000,
              vehicles: [{ vehicleId: 'bus', quantity: 1 }],
            },
            { id: 'b', dayIds: ['d2'], totalPrice: 3000, vehicles: [] },
          ],
        },
      ],
    };
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT id, data'))
        return [{ id: 'itinerary', data: plan }];
      if (sql.startsWith('SELECT id, snapshot'))
        return [
          {
            id: 'quote',
            snapshot: { itinerary: plan, calculation: { total: 4000 } },
          },
        ];
      return [];
    });
    const migration = new MigrateVehicleArrangementDateRanges1789095600000();
    await migration.up({ query } as unknown as QueryRunner);
    const calls = query.mock.calls as unknown as Array<
      [
        string,
        Array<{
          vehiclePlans: Array<{
            totalPrice: number;
            arrangements: Array<{
              startDate: string;
              endDate: string;
              totalPrice: number | null;
            }>;
          }>;
          calculation: { total: number };
        }>,
      ]
    >;
    const updated = calls.find(([sql]) =>
      sql.startsWith('UPDATE itineraries'),
    )![1][0];
    expect(
      updated.vehiclePlans[0].arrangements.map(
        (a: { startDate: string; endDate: string }) => [a.startDate, a.endDate],
      ),
    ).toEqual([
      ['2026-09-10', '2026-09-10'],
      ['2026-09-12', '2026-09-12'],
      ['2026-09-11', '2026-09-11'],
    ]);
    expect(updated.vehiclePlans[0].totalPrice).toBe(4000);
    expect(
      updated.vehiclePlans[0].arrangements.map(
        (a: { totalPrice: number | null }) => a.totalPrice,
      ),
    ).toEqual([1000, null, 3000]);
    const frozen = calls.find(([sql]) =>
      sql.startsWith('UPDATE itinerary_quotes'),
    )![1][0];
    expect(frozen.calculation).toEqual({ total: 4000 });
    await expect(migration.down()).rejects.toThrow('backup');
  });
});
