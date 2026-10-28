import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebsiteVehicleDurations1794700800000 implements MigrationInterface {
  name = 'WebsiteVehicleDurations1794700800000';

  async up(q: QueryRunner): Promise<void> {
    // Retain the old default for every authored type, without rewriting itinerary or quote values.
    await q.query(`UPDATE website_config_versions c SET config=jsonb_set(config,'{routes}',
      COALESCE((SELECT jsonb_agg((r.value-'vehicleTypes') || jsonb_build_object(
        'vehicleOptions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'vehicleType', v.value, 'durationMinutes', r.value->'durationMinutes') ORDER BY v.n)
          FROM jsonb_array_elements(COALESCE(r.value->'vehicleTypes','[]'::jsonb)) WITH ORDINALITY v(value,n)), '[]'::jsonb),
        'durationMinutes', CASE WHEN r.value->>'mode'='private_vehicle' THEN 'null'::jsonb
          ELSE COALESCE(r.value->'durationMinutes','null'::jsonb) END) ORDER BY r.n)
        FROM jsonb_array_elements(c.config->'routes') WITH ORDINALITY r(value,n)), '[]'::jsonb))`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Per-vehicle durations require a reviewed data recovery before rollback',
      ),
    );
  }
}
