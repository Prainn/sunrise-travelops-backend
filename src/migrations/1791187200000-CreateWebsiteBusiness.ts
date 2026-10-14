import { MigrationInterface, QueryRunner } from 'typeorm';

/** Independent direct-customer records; existing business tables are untouched. */
export class CreateWebsiteBusiness1791187200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE website_config_versions (
        version integer PRIMARY KEY CHECK(version >= 0),
        config jsonb NOT NULL CHECK(jsonb_typeof(config)='object'),
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id)
      );
      INSERT INTO website_config_versions(version,config) VALUES(0,
        '{"version":0,"cities":[],"attractions":[],"routes":[],"patterns":[],"skeletons":[],"templates":[]}');
      CREATE TABLE website_config_current (
        id integer PRIMARY KEY CHECK(id=1), version integer NOT NULL REFERENCES website_config_versions(version)
      );
      INSERT INTO website_config_current VALUES(1,0);
      CREATE TABLE website_inquiries (
        id uuid PRIMARY KEY, code text NOT NULL UNIQUE, customer_name varchar(100) NOT NULL,
        planned_days integer NOT NULL CHECK(planned_days BETWEEN 1 AND 365), requirements text NOT NULL,
        owner_id uuid NOT NULL REFERENCES users(id), owner varchar(100) NOT NULL,
        phone varchar(50) NOT NULL DEFAULT '', email varchar(254) NOT NULL DEFAULT '',
        start_date date, pax integer CHECK(pax > 0), arrival_time varchar(100) NOT NULL DEFAULT '',
        departure_time varchar(100) NOT NULL DEFAULT '', destinations uuid[] NOT NULL DEFAULT '{}',
        internal_remark text NOT NULL DEFAULT '', lost_reason text NOT NULL DEFAULT '',
        status text NOT NULL CHECK(status IN ('new','planning','quoted','lost','archived')),
        version integer NOT NULL DEFAULT 1 CHECK(version > 0),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX website_inquiries_owner_status ON website_inquiries(owner_id,status,created_at DESC);
      CREATE TABLE website_itineraries (
        id uuid PRIMARY KEY, inquiry_id uuid NOT NULL REFERENCES website_inquiries(id), code text NOT NULL UNIQUE,
        title varchar(150) NOT NULL, duration integer NOT NULL CHECK(duration BETWEEN 1 AND 365),
        start_date date, pax integer CHECK(pax > 0), arrival_time varchar(100) NOT NULL DEFAULT '',
        departure_time varchar(100) NOT NULL DEFAULT '', config_version integer NOT NULL REFERENCES website_config_versions(version),
        status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','quoted')),
        version integer NOT NULL DEFAULT 1 CHECK(version > 0),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX website_itineraries_inquiry ON website_itineraries(inquiry_id,created_at DESC);
      CREATE TABLE website_days (
        id uuid PRIMARY KEY, itinerary_id uuid NOT NULL REFERENCES website_itineraries(id) ON DELETE CASCADE,
        day_number integer NOT NULL CHECK(day_number BETWEEN 1 AND 365), depart_city_id uuid NOT NULL,
        end_city_id uuid NOT NULL, overnight_city_id uuid, guide_language varchar(100) NOT NULL,
        guide_scope varchar(1000) NOT NULL, UNIQUE(itinerary_id,day_number)
      );
      CREATE TABLE website_items (
        id uuid PRIMARY KEY, day_id uuid NOT NULL REFERENCES website_days(id) ON DELETE CASCADE,
        position integer NOT NULL CHECK(position >= 0), attraction_id uuid,
        name_zh varchar(150) NOT NULL, name_en varchar(150) NOT NULL,
        description_zh text NOT NULL, description_en text NOT NULL, appears boolean NOT NULL,
        fee_state text NOT NULL CHECK(fee_state IN ('INCLUDED','EXCLUDED','OPTIONAL','RECOMMENDED','ARRANGED','SELF_PAY','UNKNOWN')),
        UNIQUE(day_id,position)
      );
      CREATE TABLE website_legs (
        id uuid PRIMARY KEY, day_id uuid NOT NULL REFERENCES website_days(id) ON DELETE CASCADE,
        position integer NOT NULL CHECK(position >= 0), route_id uuid, from_city_id uuid NOT NULL, to_city_id uuid NOT NULL,
        mode text NOT NULL CHECK(mode IN ('hsr','private_vehicle','flight','other')),
        name_zh varchar(150) NOT NULL, name_en varchar(150) NOT NULL,
        fee_state text NOT NULL CHECK(fee_state IN ('INCLUDED','EXCLUDED','OPTIONAL','RECOMMENDED','ARRANGED','SELF_PAY','UNKNOWN')),
        UNIQUE(day_id,position)
      );
      CREATE TABLE website_hotels (
        id uuid PRIMARY KEY, day_id uuid NOT NULL REFERENCES website_days(id) ON DELETE CASCADE,
        position integer NOT NULL CHECK(position >= 0), tier text NOT NULL CHECK(tier IN ('A','B')),
        city_id uuid NOT NULL, resource_id uuid REFERENCES resource_hotels(id),
        name_zh varchar(150) NOT NULL, name_en varchar(150) NOT NULL,
        room_type varchar(200) NOT NULL, breakfast_included boolean NOT NULL,
        UNIQUE(day_id,tier), UNIQUE(day_id,position)
      );
      CREATE TABLE website_meals (
        id uuid PRIMARY KEY, day_id uuid NOT NULL REFERENCES website_days(id) ON DELETE CASCADE,
        position integer NOT NULL CHECK(position >= 0), slot text NOT NULL CHECK(slot IN ('breakfast','lunch','dinner')),
        resource_id uuid REFERENCES resource_restaurants(id), restaurant_zh varchar(150) NOT NULL,
        restaurant_en varchar(150) NOT NULL,
        fee_state text NOT NULL CHECK(fee_state IN ('INCLUDED','EXCLUDED','OPTIONAL','RECOMMENDED','ARRANGED','SELF_PAY','UNKNOWN')),
        UNIQUE(day_id,slot), UNIQUE(day_id,position)
      );
      CREATE TABLE website_services (
        id uuid PRIMARY KEY, day_id uuid NOT NULL REFERENCES website_days(id) ON DELETE CASCADE,
        position integer NOT NULL CHECK(position >= 0), name_zh varchar(150) NOT NULL, name_en varchar(150) NOT NULL,
        appears boolean NOT NULL,
        fee_state text NOT NULL CHECK(fee_state IN ('INCLUDED','EXCLUDED','OPTIONAL','RECOMMENDED','ARRANGED','SELF_PAY','UNKNOWN')),
        UNIQUE(day_id,position)
      );
      CREATE TABLE website_vehicle_prices (
        itinerary_id uuid NOT NULL REFERENCES website_itineraries(id) ON DELETE CASCADE,
        vehicle_type text NOT NULL CHECK(vehicle_type IN ('5_seat','7_seat','9_seat','14_seat','18_seat')),
        unit_price numeric(12,2) CHECK(unit_price >= 0), PRIMARY KEY(itinerary_id,vehicle_type)
      );
      CREATE TABLE website_quotations (
        id uuid PRIMARY KEY, itinerary_id uuid NOT NULL UNIQUE REFERENCES website_itineraries(id),
        code text NOT NULL UNIQUE, snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
        confirmed_at timestamptz NOT NULL DEFAULT now(), confirmed_by uuid NOT NULL REFERENCES users(id)
      );
      CREATE TABLE website_logs (
        id uuid PRIMARY KEY, inquiry_id uuid NOT NULL REFERENCES website_inquiries(id),
        action varchar(80) NOT NULL, target_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
        actor_name varchar(100) NOT NULL, detail text NOT NULL DEFAULT '', occurred_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX website_logs_inquiry_time ON website_logs(inquiry_id,occurred_at DESC,id DESC);
    `);
    // Register identifiers only: effective permissions depend on the login identity.
    for (const [code, name] of permissions) {
      await q.query('INSERT INTO permissions(code,name) VALUES($1,$2)', [
        code,
        name,
      ]);
    }
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE website_logs,website_quotations,website_vehicle_prices,
      website_services,website_meals,website_hotels,website_legs,website_items,website_days,
      website_itineraries,website_inquiries,website_config_current,website_config_versions`);
    await q.query('DELETE FROM permissions WHERE code=ANY($1::text[])', [
      permissions.map(([code]) => code),
    ]);
  }
}
const permissions = [
  ['website:inquiry:list', '查看独立站询盘'],
  ['website:inquiry:create', '创建独立站询盘'],
  ['website:inquiry:update', '修改独立站询盘'],
  ['website:inquiry:transfer', '转交独立站询盘'],
  ['website:inquiry:archive', '归档独立站询盘'],
  ['website:itinerary:list', '查看独立站行程'],
  ['website:itinerary:create', '创建独立站行程'],
  ['website:itinerary:update', '修改独立站行程'],
  ['website:itinerary:confirm', '确认独立站报价'],
  ['website:itinerary:download', '下载独立站冻结报价'],
  ['website:config:list', '查看独立站配置'],
  ['website:config:update', '维护独立站配置'],
];
