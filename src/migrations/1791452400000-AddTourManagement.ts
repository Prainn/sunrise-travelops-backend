import { MigrationInterface, QueryRunner } from 'typeorm';

const PERMISSIONS: [string, string, string[]][] = [
  [
    'tour:list',
    '查看成团表',
    ['ROOT', 'ADMIN', 'EXECUTIVE', 'BUSINESS_MANAGER', 'COORDINATOR'],
  ],
  ['tour:create', '创建旅行团', ['BUSINESS_MANAGER', 'COORDINATOR']],
  ['tour:update', '修改旅行团', ['BUSINESS_MANAGER', 'COORDINATOR']],
  ['tour:cancel', '撤销旅行团', ['BUSINESS_MANAGER', 'COORDINATOR']],
  ['tour:rating:update', '导游评分', ['BUSINESS_MANAGER', 'COORDINATOR']],
];

export class AddTourManagement1791452400000 implements MigrationInterface {
  name = 'AddTourManagement1791452400000';

  async up(q: QueryRunner): Promise<void> {
    // Users: English name (backfilled from username) and tour-number tag.
    await q.query(
      `ALTER TABLE users ADD COLUMN english_name varchar(100), ADD COLUMN tour_code varchar(10)`,
    );
    await q.query(`UPDATE users SET english_name = username`);
    await q.query(`ALTER TABLE users ALTER COLUMN english_name SET NOT NULL`);

    // Business dictionaries; items are initialised per environment.
    await q.query(`INSERT INTO system_business_dictionary_types (name, english_name, code, is_built_in)
      VALUES ('国家和地区', 'Country and Region', 'country-region', true),
             ('城市机场', 'City Airport', 'city-airport', true)
      ON CONFLICT (code) DO NOTHING`);

    // Country references. Legacy free text stays untouched.
    await q.query(
      `ALTER TABLE resource_agencies ADD COLUMN country_item_id uuid
       CONSTRAINT FK_resource_agencies_country REFERENCES system_business_dictionary_items(id)`,
    );
    await q.query(`ALTER TABLE inquiries
      ADD COLUMN country_item_id uuid CONSTRAINT FK_inquiries_country REFERENCES system_business_dictionary_items(id),
      ADD COLUMN country_code varchar(3)`);
    await q.query(`ALTER TABLE website_inquiries
      ADD COLUMN country_item_id uuid CONSTRAINT FK_website_inquiries_country REFERENCES system_business_dictionary_items(id),
      ADD COLUMN country_code varchar(3),
      ADD COLUMN country_or_region text NOT NULL DEFAULT ''`);

    // Flights reference concrete airports.
    await q.query(`ALTER TABLE resource_flights
      ADD COLUMN departure_airport_id uuid CONSTRAINT FK_resource_flights_departure_airport REFERENCES system_business_dictionary_items(id),
      ADD COLUMN arrival_airport_id uuid CONSTRAINT FK_resource_flights_arrival_airport REFERENCES system_business_dictionary_items(id)`);
    await q.query(`CREATE UNIQUE INDEX UQ_resource_flights_airport_schedule
      ON resource_flights (library, departure_airport_id, arrival_airport_id, flight_number, departure_time, arrival_time)
      WHERE deleted_at IS NULL AND departure_airport_id IS NOT NULL AND arrival_airport_id IS NOT NULL`);

    // Download clicks live beside, never inside, the frozen snapshots.
    await q.query(`ALTER TABLE itinerary_quotes
      ADD COLUMN first_downloaded_at timestamptz, ADD COLUMN first_downloaded_by uuid`);
    await q.query(`ALTER TABLE website_quotations
      ADD COLUMN first_downloaded_at timestamptz, ADD COLUMN first_downloaded_by uuid`);

    await q.query(`CREATE TABLE tours (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tour_no varchar(80) NOT NULL,
      source_module text NOT NULL CHECK (source_module IN ('standard','website')),
      business_unit text NOT NULL CHECK (business_unit IN ('shengxu','linxi','website')),
      library text NOT NULL REFERENCES resource_libraries(code),
      inquiry_id uuid NOT NULL,
      quote_id uuid NOT NULL,
      itinerary_id uuid NOT NULL,
      inquiry_code text NOT NULL,
      itinerary_code text NOT NULL,
      quote_code text NOT NULL,
      agency_name text NOT NULL DEFAULT '',
      contact_name text NOT NULL DEFAULT '',
      days integer NOT NULL CHECK (days BETWEEN 1 AND 365),
      start_date date NOT NULL,
      pickup_at timestamp NOT NULL,
      drop_at timestamp NOT NULL,
      occupy_from date NOT NULL,
      occupy_to date NOT NULL,
      country_item_id uuid NOT NULL REFERENCES system_business_dictionary_items(id),
      country_code varchar(3) NOT NULL,
      country_name text NOT NULL,
      creator_id uuid NOT NULL REFERENCES users(id),
      creator_tour_code varchar(10) NOT NULL,
      creator_sequence integer NOT NULL CHECK (creator_sequence > 0),
      collect_coordinator_id uuid NOT NULL REFERENCES users(id),
      collect_coordinator_name text NOT NULL,
      operator_id uuid NOT NULL REFERENCES users(id),
      operator_name text NOT NULL,
      adults integer NOT NULL CHECK (adults >= 0),
      children integer NOT NULL CHECK (children >= 0),
      leaders integer NOT NULL CHECK (leaders >= 0),
      language text NOT NULL DEFAULT '',
      shopping boolean NOT NULL DEFAULT false,
      pickup_flight_id uuid NOT NULL REFERENCES resource_flights(id),
      drop_flight_id uuid NOT NULL REFERENCES resource_flights(id),
      pickup_flight jsonb NOT NULL,
      drop_flight jsonb NOT NULL,
      guide_id uuid REFERENCES resource_guide_people(id),
      remark text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
      cancelled_at timestamptz,
      cancelled_by uuid,
      cancel_reason text NOT NULL DEFAULT '',
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid,
      CONSTRAINT UQ_tours_tour_no UNIQUE (tour_no)
    )`);
    await q.query(
      `CREATE UNIQUE INDEX UQ_tours_active_inquiry ON tours (source_module, inquiry_id) WHERE status = 'active'`,
    );
    await q.query(
      `CREATE INDEX IDX_tours_guide_occupancy ON tours (guide_id, occupy_from, occupy_to) WHERE status = 'active' AND guide_id IS NOT NULL`,
    );
    await q.query(
      `CREATE INDEX IDX_tours_list ON tours (business_unit, start_date DESC, id)`,
    );
    await q.query(`CREATE TABLE tour_number_counters (
      creator_id uuid NOT NULL REFERENCES users(id),
      pickup_date date NOT NULL,
      last_value integer NOT NULL,
      PRIMARY KEY (creator_id, pickup_date)
    )`);

    await q.query(`CREATE TABLE resource_guide_leaves (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      guide_person_id uuid NOT NULL REFERENCES resource_guide_people(id),
      start_date date NOT NULL,
      end_date date NOT NULL,
      reason varchar(200) NOT NULL DEFAULT '',
      remark text NOT NULL DEFAULT '',
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid,
      deleted_at timestamptz,
      CONSTRAINT CHK_resource_guide_leaves_range CHECK (start_date <= end_date)
    )`);
    await q.query(
      `CREATE INDEX IDX_resource_guide_leaves_guide ON resource_guide_leaves (guide_person_id, start_date, end_date) WHERE deleted_at IS NULL`,
    );

    const score = (name: string) =>
      `${name} numeric(5,2) CHECK (${name} IS NULL OR (${name} >= 0 AND ${name} <= 100))`;
    await q.query(`CREATE TABLE tour_ratings (
      tour_id uuid PRIMARY KEY REFERENCES tours(id),
      guide_id uuid NOT NULL REFERENCES resource_guide_people(id),
      ${score('self_score')}, ${score('manager_score')}, ${score('collect_score')}, ${score('operator_score')},
      ${score('bonus_car_purchase')}, ${score('bonus_recommended_self_pay')}, ${score('bonus_praise')},
      ${score('bonus_designated')}, ${score('bonus_incident')},
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid
    )`);

    for (const [code, name, roles] of PERMISSIONS) {
      await q.query(
        `INSERT INTO permissions (code, name) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING`,
        [code, name],
      );
      await q.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
         WHERE r.code = ANY($1::text[]) AND p.code = $2 ON CONFLICT DO NOTHING`,
        [roles, code],
      );
    }
    for (const [code, name] of [
      ['resource:guide:list', '查看导游管理'],
      ['resource:guide:create', '新增导游管理'],
      ['resource:guide:update', '修改导游管理'],
      ['resource:guide:delete', '删除导游管理'],
    ])
      await q.query(`UPDATE permissions SET name = $2 WHERE code = $1`, [
        code,
        name,
      ]);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Restore a pre-migration backup to remove tour data safely'),
    );
  }
}
