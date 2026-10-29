import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebsiteRouteVehicleOptions1794614400000 implements MigrationInterface {
  name = 'WebsiteRouteVehicleOptions1794614400000';

  async up(q: QueryRunner): Promise<void> {
    // Quote snapshots keep their authored single selection and are never rewritten.
    await q.query(
      `ALTER TABLE website_legs DROP CONSTRAINT website_legs_vehicle_type_check`,
    );
    await q.query(`ALTER TABLE website_legs ADD CONSTRAINT website_legs_vehicle_type_check
      CHECK(vehicle_type IS NULL OR (length(btrim(vehicle_type)) BETWEEN 1 AND 100 AND vehicle_type=btrim(vehicle_type)))`);
    await q.query(`UPDATE website_config_versions c SET config=jsonb_set(config,'{routes}',
      COALESCE((SELECT jsonb_agg((r.value-'vehicleType'-'showInMileage') || jsonb_build_object('vehicleTypes',
        CASE WHEN r.value->>'vehicleType' IS NULL THEN '[]'::jsonb
          ELSE jsonb_build_array(r.value->>'vehicleType') END) ORDER BY r.n)
        FROM jsonb_array_elements(c.config->'routes') WITH ORDINALITY r(value,n)), '[]'::jsonb))`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Multiple and custom vehicle types require a reviewed data recovery before rollback',
      ),
    );
  }
}
