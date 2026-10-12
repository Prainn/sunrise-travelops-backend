import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-time switch to a single public resource library.
 * Keeps the former shengxu resources unchanged, deletes the former shared
 * resources, and removes the library structure. Data deletion is irreversible.
 */
export class UnifyResourceLibrary1791619200000 implements MigrationInterface {
  name = 'UnifyResourceLibrary1791619200000';

  async up(q: QueryRunner): Promise<void> {
    // Website configuration gains a hotels collection; frozen outputs are untouched.
    await q.query(
      `UPDATE website_config_versions SET config = config || '{"hotels":[]}'::jsonb WHERE NOT config ? 'hotels'`,
    );
    await q.query(`ALTER TABLE website_hotels ADD COLUMN config_hotel_id uuid`);

    const shared = async (table: string): Promise<string[]> => {
      const rows = (await q.query(
        `SELECT id FROM ${table} WHERE library = 'shared'`,
      )) as { id: string }[];
      return rows.map((row) => row.id);
    };
    const ids = {
      cities: await shared('resource_cities'),
      agencies: await shared('resource_agencies'),
      hotels: await shared('resource_hotels'),
      restaurants: await shared('resource_restaurants'),
      attractions: await shared('resource_attractions'),
      transports: await shared('resource_transports'),
      guides: await shared('resource_guides'),
      people: await shared('resource_guide_people'),
      flights: await shared('resource_flights'),
    };

    // Required references have no replacement: report them and abort.
    const blockers: string[] = [];
    const report = async (label: string, sql: string, params: unknown[]) => {
      const rows = (await q.query(sql, params)) as Array<{ ref: string }>;
      if (rows.length)
        blockers.push(`${label}: ${rows.map((r) => r.ref).join(', ')}`);
    };
    await report(
      'tours using shared flights',
      `SELECT tour_no AS ref FROM tours WHERE pickup_flight_id = ANY($1::uuid[]) OR drop_flight_id = ANY($1::uuid[])`,
      [ids.flights],
    );
    await report(
      'tours using shared guides',
      `SELECT tour_no AS ref FROM tours WHERE guide_id = ANY($1::uuid[])`,
      [ids.people],
    );
    await report(
      'guide ratings using shared guides',
      `SELECT tour_id::text AS ref FROM tour_ratings WHERE guide_id = ANY($1::uuid[])`,
      [ids.people],
    );
    await report(
      'guide leaves using shared guides',
      `SELECT id::text AS ref FROM resource_guide_leaves WHERE guide_person_id = ANY($1::uuid[])`,
      [ids.people],
    );
    await report(
      'inquiries using shared agencies',
      `SELECT code AS ref FROM inquiries WHERE agency_id = ANY($1::uuid[])`,
      [ids.agencies],
    );
    // Standard itineraries use structured detail tables, not a data JSON column.
    for (const [table, column, references] of [
      ['itinerary_hotels', 'hotel_id', ids.hotels],
      ['itinerary_vehicles', 'vehicle_id', ids.transports],
      ['itinerary_guides', 'guide_id', ids.guides],
      [
        'itinerary_items',
        'resource_id',
        [...ids.restaurants, ...ids.attractions],
      ],
    ] as const)
      await report(
        `standard itineraries referencing shared resources (${table})`,
        `SELECT DISTINCT i.code AS ref FROM itineraries i
         JOIN ${table} d ON d.itinerary_id = i.id WHERE d.${column} = ANY($1::uuid[])`,
        [references],
      );
    if (blockers.length)
      throw new Error(
        `Cannot unify resource library; map or resolve these records first:\n${blockers.join('\n')}`,
      );

    // Website-owned content keeps its own text; only the public references go.
    await q.query(
      `UPDATE website_hotels SET resource_id = NULL WHERE resource_id = ANY($1::uuid[])`,
      [ids.hotels],
    );
    await q.query(
      `UPDATE website_meals SET resource_id = NULL WHERE resource_id = ANY($1::uuid[])`,
      [ids.restaurants],
    );
    for (const [kind, list] of [
      ['cities', ids.cities],
      ['attractions', ids.attractions],
    ] as const)
      await q.query(
        `UPDATE website_config_versions v SET config = jsonb_set(v.config, ARRAY[$2], (
           SELECT COALESCE(jsonb_agg(CASE WHEN e->>'resourceId' = ANY($1::text[])
             THEN jsonb_set(e, '{resourceId}', 'null'::jsonb) ELSE e END ORDER BY p), '[]'::jsonb)
           FROM jsonb_array_elements(v.config->$2) WITH ORDINALITY AS t(e, p)))
         WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v.config->$2) e WHERE e->>'resourceId' = ANY($1::text[]))`,
        [list, kind],
      );

    // Children first, then the former shared resources.
    await q.query(
      `DELETE FROM resource_agency_contacts WHERE agency_id = ANY($1::uuid[])`,
      [ids.agencies],
    );
    await q.query(
      `DELETE FROM resource_agencies WHERE id = ANY($1::uuid[]) AND parent_id IS NOT NULL`,
      [ids.agencies],
    );
    await q.query(`DELETE FROM resource_agencies WHERE id = ANY($1::uuid[])`, [
      ids.agencies,
    ]);
    await q.query(
      `DELETE FROM resource_restaurant_prices WHERE restaurant_id = ANY($1::uuid[])`,
      [ids.restaurants],
    );
    await q.query(
      `DELETE FROM resource_restaurants WHERE id = ANY($1::uuid[])`,
      [ids.restaurants],
    );
    await q.query(
      `DELETE FROM resource_attraction_prices WHERE attraction_id = ANY($1::uuid[])`,
      [ids.attractions],
    );
    await q.query(
      `DELETE FROM resource_attractions WHERE id = ANY($1::uuid[])`,
      [ids.attractions],
    );
    for (const [table, list] of [
      ['resource_hotels', ids.hotels],
      ['resource_transports', ids.transports],
      ['resource_guides', ids.guides],
      ['resource_guide_people', ids.people],
      ['resource_flights', ids.flights],
      ['resource_cities', ids.cities],
    ] as const)
      await q.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [list]);

    // Remove the library structure.
    for (const table of [
      'resource_cities',
      'resource_agencies',
      'resource_hotels',
      'resource_restaurants',
      'resource_attractions',
      'resource_transports',
      'resource_guides',
      'resource_guide_people',
      'resource_flights',
      'tours',
    ])
      await q.query(`ALTER TABLE ${table} DROP COLUMN library`);
    await q.query(`ALTER TABLE business_units DROP COLUMN resource_library`);
    await q.query(`DROP TABLE resource_libraries`);

    // Uniqueness now applies to the whole public library.
    await q.query(`
      CREATE UNIQUE INDEX "UQ_resource_cities_name" ON resource_cities(name) WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX "UQ_resource_guides_service" ON resource_guides(second_language, shopping) WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX "UQ_resource_attractions_standard_city" ON resource_attractions(area) WHERE deleted_at IS NULL AND is_standard_price;
      CREATE UNIQUE INDEX "UQ_resource_restaurants_standard_city" ON resource_restaurants(city) WHERE deleted_at IS NULL AND is_standard_price;
      CREATE INDEX "IDX_resource_flights_status" ON resource_flights(status) WHERE deleted_at IS NULL;
      CREATE INDEX "IDX_resource_guide_people_status" ON resource_guide_people(status) WHERE deleted_at IS NULL;
      CREATE UNIQUE INDEX "UQ_resource_flights_schedule" ON resource_flights(departure_city, arrival_city, flight_number, departure_time, arrival_time)
        WHERE deleted_at IS NULL AND (departure_airport_id IS NULL OR arrival_airport_id IS NULL);
      CREATE UNIQUE INDEX "UQ_resource_flights_airport_schedule" ON resource_flights(departure_airport_id, arrival_airport_id, flight_number, departure_time, arrival_time)
        WHERE deleted_at IS NULL AND departure_airport_id IS NOT NULL AND arrival_airport_id IS NOT NULL;
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Deleted shared-library resources cannot be restored'),
    );
  }
}
