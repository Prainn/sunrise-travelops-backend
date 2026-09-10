import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';

interface VehicleArrangement {
  dayIds?: string[];
  startDate?: string;
  endDate?: string;
  [key: string]: unknown;
}

interface ItineraryPlan {
  startDate: string;
  dailyPlans: Array<{ id: string; date: string }>;
  vehiclePlans: Array<{
    arrangements: VehicleArrangement[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

function withDateRanges(plan: ItineraryPlan): ItineraryPlan {
  const datesByDayId = new Map(
    plan.dailyPlans.map((day) => [day.id, day.date]),
  );
  return {
    ...plan,
    vehiclePlans: plan.vehiclePlans.map((vehiclePlan) => ({
      ...vehiclePlan,
      arrangements: vehiclePlan.arrangements.flatMap((arrangement) => {
        if (!Array.isArray(arrangement.dayIds)) return [arrangement];
        const dates = [
          ...new Set(
            arrangement.dayIds.map((id) => {
              const date = datesByDayId.get(id);
              if (!date) throw new Error(`Missing itinerary day: ${id}`);
              return date;
            }),
          ),
        ].sort();
        const rest = { ...arrangement };
        delete rest.dayIds;
        if (!dates.length) return [{ ...rest, startDate: '', endDate: '' }];
        const ranges: Array<{ startDate: string; endDate: string }> = [];
        for (const date of dates) {
          const previous = ranges.at(-1);
          const next = previous
            ? new Date(`${previous.endDate}T00:00:00Z`)
            : null;
          if (next) next.setUTCDate(next.getUTCDate() + 1);
          if (previous && next?.toISOString().slice(0, 10) === date)
            previous.endDate = date;
          else ranges.push({ startDate: date, endDate: date });
        }
        return ranges.map((range, index) => ({
          ...rest,
          ...range,
          id: index === 0 ? rest.id : randomUUID(),
          // Keep the supplied whole-arrangement amount once, never multiply it when splitting.
          ...(index > 0 && rest.totalPrice != null ? { totalPrice: null } : {}),
        }));
      }),
    })),
  };
}

export class MigrateVehicleArrangementDateRanges1789095600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const itineraries = (await queryRunner.query(
      'SELECT id, data FROM itineraries',
    )) as Array<{ id: string; data: ItineraryPlan }>;
    for (const row of itineraries)
      await queryRunner.query(
        'UPDATE itineraries SET data=$1, version=version+1 WHERE id=$2',
        [withDateRanges(row.data), row.id],
      );

    const quotes = (await queryRunner.query(
      'SELECT id, snapshot FROM itinerary_quotes',
    )) as Array<{
      id: string;
      snapshot: { itinerary: ItineraryPlan };
    }>;
    for (const row of quotes)
      await queryRunner.query(
        'UPDATE itinerary_quotes SET snapshot=$1 WHERE id=$2',
        [
          {
            ...row.snapshot,
            itinerary: withDateRanges(row.snapshot.itinerary),
          },
          row.id,
        ],
      );
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Restore the pre-migration database backup and matching application; date-range data cannot be safely converted back',
      ),
    );
  }
}
