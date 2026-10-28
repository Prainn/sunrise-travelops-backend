import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebsiteTransportMileage1794528000000 implements MigrationInterface {
  name = 'WebsiteTransportMileage1794528000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE website_legs
      ADD COLUMN vehicle_type text CHECK(vehicle_type IN ('5_seat','7_seat','9_seat','14_seat','18_seat')),
      ADD COLUMN distance_km numeric(12,2) CHECK(distance_km>=0),
      ADD COLUMN duration_minutes integer CHECK(duration_minutes BETWEEN 1 AND 525600),
      ADD COLUMN show_in_mileage boolean NOT NULL DEFAULT false,
      ADD CONSTRAINT website_leg_vehicle_mode CHECK(mode='private_vehicle' OR vehicle_type IS NULL)`);
    // Keep original authored configuration for a reviewed recovery; frozen quotations are untouched.
    await q.query(`CREATE TABLE website_transport_mileage_backup AS
      SELECT version,config FROM website_config_versions`);
    await q.query(`CREATE TEMP TABLE website_mileage_matches ON COMMIT DROP AS
      SELECT s.itinerary_id,s.mileage_id,m.value AS mileage,l.id AS leg_id
      FROM website_itinerary_mileages s
      JOIN website_itineraries i ON i.id=s.itinerary_id
      LEFT JOIN website_config_versions c ON c.version=i.config_version AND c.business_unit=i.business_unit
      LEFT JOIN LATERAL jsonb_array_elements(c.config->'mileages') m(value) ON m.value->>'id'=s.mileage_id::text
      LEFT JOIN website_days d ON d.itinerary_id=i.id AND NOT d.is_deleted
      LEFT JOIN website_legs l ON l.day_id=d.id AND l.from_city_id::text=m.value->>'fromCityId'
        AND l.to_city_id::text=m.value->>'toCityId' AND l.mode=m.value->>'mode'`);
    await q.query(`DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM website_mileage_matches GROUP BY itinerary_id,mileage_id HAVING count(leg_id)<>1)
        OR EXISTS(SELECT 1 FROM website_mileage_matches WHERE leg_id IS NOT NULL GROUP BY leg_id HAVING count(*)>1)
      THEN RAISE EXCEPTION 'Legacy mileage selection cannot uniquely match transport legs; review selections before migration'; END IF;
      IF EXISTS(SELECT 1 FROM website_config_versions WHERE
        jsonb_array_length(config->'routes')+jsonb_array_length(config->'mileages')>5000)
      THEN RAISE EXCEPTION 'Combined transport resources exceed 5000; review before migration'; END IF;
    END $$`);
    await q.query(`UPDATE website_legs l SET distance_km=(m.mileage->>'distanceKm')::numeric,
      duration_minutes=(m.mileage->>'durationMinutes')::integer,show_in_mileage=true
      FROM website_mileage_matches m WHERE l.id=m.leg_id`);
    await q.query(`UPDATE website_config_versions c SET config=jsonb_set(config-'mileages','{routes}',
      COALESCE((SELECT jsonb_agg('{"vehicleType":null,"distanceKm":null,"durationMinutes":null,"showInMileage":false}'::jsonb || r.value ORDER BY r.n)
        FROM jsonb_array_elements(c.config->'routes') WITH ORDINALITY r(value,n)),'[]'::jsonb)
      || COALESCE((SELECT jsonb_agg(m.value || jsonb_build_object(
        'vehicleType',null,'showInMileage',true,'feeState','UNKNOWN',
        'nameZh',concat_ws(' → ',f.value->>'nameZh',t.value->>'nameZh'),
        'nameEn',concat_ws(' → ',f.value->>'nameEn',t.value->>'nameEn')) ORDER BY m.n)
        FROM jsonb_array_elements(c.config->'mileages') WITH ORDINALITY m(value,n)
        LEFT JOIN LATERAL jsonb_array_elements(c.config->'cities') f(value) ON f.value->>'id'=m.value->>'fromCityId'
        LEFT JOIN LATERAL jsonb_array_elements(c.config->'cities') t(value) ON t.value->>'id'=m.value->>'toCityId'), '[]'::jsonb))`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Transport mileage data prevents rollback; restore from reviewed backup',
      ),
    );
  }
}
