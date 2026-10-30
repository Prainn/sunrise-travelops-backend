import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebsiteRouteModeFields1794960000000 implements MigrationInterface {
  name = 'WebsiteRouteModeFields1794960000000';

  async up(q: QueryRunner): Promise<void> {
    // Only remove redundant null/empty values; never discard authored durations or vehicles.
    await q.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM website_config_versions c,
        jsonb_array_elements(c.config->'routes') r
        WHERE (r->>'mode'='private_vehicle' AND r->'durationMinutes' IS NOT NULL AND r->'durationMinutes'<>'null'::jsonb)
           OR (r->>'mode'<>'private_vehicle' AND r->'vehicleOptions' IS NOT NULL AND r->'vehicleOptions'<>'[]'::jsonb))
      THEN RAISE EXCEPTION 'Route mode fields contain non-redundant values; review before migration'; END IF;
    END $$`);
    await q.query(`UPDATE website_config_versions c SET config=jsonb_set(config,'{routes}',
      COALESCE((SELECT jsonb_agg(CASE WHEN r.value->>'mode'='private_vehicle'
        THEN r.value-'durationMinutes' ELSE r.value-'vehicleOptions' END ORDER BY r.n)
        FROM jsonb_array_elements(c.config->'routes') WITH ORDINALITY r(value,n)), '[]'::jsonb))`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Route mode fields require a reviewed database recovery before rollback',
      ),
    );
  }
}
