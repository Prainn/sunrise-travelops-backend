import { MigrationInterface, QueryRunner } from 'typeorm';

interface PreviousPlan {
  leaderCount?: number;
  dailyPlans: Array<{
    id: string;
    meals: { breakfast: boolean };
    overnightDestination: string | null;
  }>;
  hotelPlans: Array<{ hotels: Array<Record<string, unknown>> }>;
  vehiclePlans: Array<{
    tier: string;
    vehicle?: {
      vehicleId: string;
      vehicleName: string;
      seats: number;
      serviceDays: number;
      unitCost: number;
    } | null;
  }>;
  guidePlans: Array<{
    destination: string;
    guideId: string;
    guideName: string;
    dailyPrice: number;
    dayIds: string[];
  }>;
  quote: Record<string, unknown>;
}
function convert(plan: PreviousPlan, frozen: boolean) {
  return {
    ...plan,
    leaderCount: 0,
    hotelPlans: plan.hotelPlans.map((p) => ({
      ...p,
      hotels: p.hotels.map((h) => {
        const hotel = { ...h };
        delete hotel.breakfastIncluded;
        return hotel;
      }),
    })),
    vehiclePlans: plan.vehiclePlans.map((p, index) => ({
      tier: p.tier,
      totalPrice: p.vehicle
        ? Number((p.vehicle.unitCost * p.vehicle.serviceDays).toFixed(2))
        : null,
      arrangements: p.vehicle
        ? [
            {
              id: `migrated-vehicle-${index}`,
              dayIds: plan.dailyPlans
                .slice(0, p.vehicle.serviceDays)
                .map((d) => d.id),
              vehicles: [
                {
                  vehicleId: p.vehicle.vehicleId,
                  vehicleName: p.vehicle.vehicleName,
                  seats: p.vehicle.seats,
                  quantity: 1,
                },
              ],
            },
          ]
        : [],
    })),
    // Personnel records have no shopping-rate classification. Drafts must select a new service rate.
    guidePlans: frozen
      ? plan.guidePlans.map((g) => ({
          destination: g.destination,
          guideId: g.guideId,
          guideName: g.guideName,
          dailyPrice: g.dailyPrice,
          serviceDays: g.dayIds.length,
          secondLanguage: 'none',
          shopping: false,
        }))
      : [],
    quote: { ...plan.quote, otherExpenses: 0 },
    dailyPlans: plan.dailyPlans.map((day, index) => ({
      ...day,
      meals: {
        ...day.meals,
        breakfast: frozen
          ? day.meals.breakfast
          : Boolean(plan.dailyPlans[index - 1]?.overnightDestination),
      },
    })),
  };
}
export class ReviseTravelPlanning1788912000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    const itineraries = (await q.query(
      'SELECT id, data FROM itineraries',
    )) as Array<{ id: string; data: PreviousPlan }>;
    for (const row of itineraries)
      await q.query(
        'UPDATE itineraries SET data=$1, version=version+1 WHERE id=$2',
        [convert(row.data, false), row.id],
      );
    const quotes = (await q.query(
      'SELECT id, snapshot FROM itinerary_quotes',
    )) as Array<{ id: string; snapshot: { itinerary: PreviousPlan } }>;
    for (const row of quotes)
      await q.query('UPDATE itinerary_quotes SET snapshot=$1 WHERE id=$2', [
        { ...row.snapshot, itinerary: convert(row.snapshot.itinerary, true) },
        row.id,
      ]);
    await q.query('ALTER TABLE resource_hotels DROP COLUMN breakfast_included');
    await q.query(
      'ALTER TABLE resource_transports DROP COLUMN daily_price, DROP COLUMN city',
    );
    await q.query('DELETE FROM resource_guides');
    await q.query(
      `ALTER TABLE resource_guides DROP COLUMN certificate_no, DROP COLUMN gender, DROP COLUMN age, DROP COLUMN languages, DROP COLUMN employment_type, DROP COLUMN identity_number, DROP COLUMN phone, DROP COLUMN unit, DROP COLUMN has_labor_contract, DROP COLUMN ground_operator_id, DROP COLUMN license_photo_url, DROP COLUMN remark`,
    );
    await q.query(
      `ALTER TABLE resource_guides ADD COLUMN second_language varchar(20) NOT NULL, ADD COLUMN shopping boolean NOT NULL, ADD CONSTRAINT "CHK_resource_guides_language" CHECK (second_language IN ('none','en','th','vi','ms','id','my','km','lo'))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_resource_guides_service" ON resource_guides(second_language,shopping) WHERE deleted_at IS NULL`,
    );
    await q.query(
      `INSERT INTO roles(code,name) VALUES ('COORDINATOR','计调') ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name`,
    );
    await q.query(
      `INSERT INTO user_roles(user_id,role_id) SELECT ur.user_id,n.id FROM user_roles ur JOIN roles o ON o.id=ur.role_id CROSS JOIN roles n WHERE o.code IN ('INQUIRY_COORDINATOR','OPERATIONS_COORDINATOR') AND n.code='COORDINATOR' ON CONFLICT DO NOTHING`,
    );
    await q.query(
      `INSERT INTO role_permissions(role_id,permission_id) SELECT n.id,rp.permission_id FROM role_permissions rp JOIN roles o ON o.id=rp.role_id CROSS JOIN roles n WHERE o.code IN ('INQUIRY_COORDINATOR','OPERATIONS_COORDINATOR') AND n.code='COORDINATOR' ON CONFLICT DO NOTHING`,
    );
    await q.query(
      `DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE code IN ('INQUIRY_COORDINATOR','OPERATIONS_COORDINATOR'))`,
    );
    await q.query(
      `DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code IN ('INQUIRY_COORDINATOR','OPERATIONS_COORDINATOR'))`,
    );
    await q.query(
      `DELETE FROM roles WHERE code IN ('INQUIRY_COORDINATOR','OPERATIONS_COORDINATOR')`,
    );
    await q.query(
      `UPDATE inquiry_logs SET roles=replace(replace(roles::text,'INQUIRY_COORDINATOR','COORDINATOR'),'OPERATIONS_COORDINATOR','COORDINATOR')::jsonb`,
    );
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Personnel data cleanup is irreversible; restore the pre-migration backup.',
      ),
    );
  }
}
