import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddInquiriesAndLogs1788858000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE inquiries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar NOT NULL UNIQUE,
      owner_id uuid NOT NULL REFERENCES users(id), owner varchar NOT NULL, status varchar NOT NULL DEFAULT 'new' CHECK (status IN ('new','planning','quoted','lost','archived')),
      creator varchar NOT NULL, data jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_by uuid
    )`);
    await q.query(
      `CREATE INDEX "IDX_inquiries_owner_created" ON inquiries(owner_id,created_at)`,
    );
    await q.query(`CREATE TABLE itineraries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inquiry_id uuid NOT NULL REFERENCES inquiries(id), code varchar NOT NULL UNIQUE,
      status varchar NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','quoted')), creator varchar NOT NULL, data jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_by uuid
    )`);
    await q.query(
      `CREATE INDEX "IDX_itineraries_inquiry_updated" ON itineraries(inquiry_id,updated_at)`,
    );
    await q.query(`CREATE TABLE itinerary_quotes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), itinerary_id uuid NOT NULL UNIQUE REFERENCES itineraries(id), source_version integer NOT NULL,
      created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), snapshot jsonb NOT NULL
    )`);
    await q.query(`CREATE TABLE inquiry_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inquiry_id uuid NOT NULL REFERENCES inquiries(id), inquiry_code varchar NOT NULL,
      action varchar NOT NULL CHECK (action IN ('inquiry_created','inquiry_updated','itinerary_created','itinerary_saved','itinerary_pdf_generated','inquiry_archived','inquiry_lost')),
      occurred_at timestamptz NOT NULL DEFAULT now(), operator_id uuid NOT NULL, operator_username varchar NOT NULL, operator_name varchar NOT NULL,
      roles jsonb NOT NULL, target_type varchar NOT NULL, target_id uuid NOT NULL, target_code varchar NOT NULL, summary varchar NOT NULL,
      metadata jsonb NOT NULL, changes jsonb NOT NULL, ip varchar NOT NULL DEFAULT '', request_id varchar NOT NULL DEFAULT ''
    )`);
    await q.query(
      `CREATE INDEX "IDX_inquiry_logs_inquiry_time" ON inquiry_logs(inquiry_id,occurred_at)`,
    );
    await q.query(
      `CREATE INDEX "IDX_inquiry_logs_operator_time" ON inquiry_logs(operator_id,occurred_at)`,
    );
    await q.query(
      `CREATE INDEX "IDX_inquiry_logs_time" ON inquiry_logs(occurred_at)`,
    );
    await q.query(
      `INSERT INTO roles(code,name) VALUES ('INQUIRY_COORDINATOR','Inquiry Coordinator') ON CONFLICT(code) DO UPDATE SET name = EXCLUDED.name`,
    );
    await q.query(
      `INSERT INTO user_roles(user_id,role_id) SELECT ur.user_id, next.id FROM user_roles ur JOIN roles old ON old.id = ur.role_id CROSS JOIN roles next WHERE old.code = 'OPERATIONS_COORDINATOR' AND next.code = 'INQUIRY_COORDINATOR' ON CONFLICT DO NOTHING`,
    );
    await q.query(
      `DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE code = 'OPERATIONS_COORDINATOR')`,
    );
    await q.query(
      `DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code = 'OPERATIONS_COORDINATOR')`,
    );
    await q.query(`DELETE FROM roles WHERE code = 'OPERATIONS_COORDINATOR'`);
    const permissions = [
      'inquiry:list',
      'inquiry:create',
      'inquiry:update',
      'itinerary:list',
      'itinerary:create',
      'itinerary:update',
      'itinerary:price',
      'itinerary:pdf',
      ...[
        'city',
        'agency',
        'supplier',
        'hotel',
        'restaurant',
        'attraction',
        'transport',
        'guide',
      ].map((r) => `resource:${r}:list`),
    ];
    for (const permission of permissions) {
      await q.query(
        `INSERT INTO permissions(code,name) VALUES ($1,$1) ON CONFLICT DO NOTHING`,
        [permission],
      );
      await q.query(
        `INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code IN ('INQUIRY_COORDINATOR','ROOT','ADMIN') AND p.code = $1 ON CONFLICT DO NOTHING`,
        [permission],
      );
    }
  }
  async down(q: QueryRunner): Promise<void> {
    // Role merging cannot infer which users previously had each role; retain the unified assignments.
    await q.query('DROP TABLE inquiry_logs');
    await q.query('DROP TABLE itinerary_quotes');
    await q.query('DROP TABLE itineraries');
    await q.query('DROP TABLE inquiries');
  }
}
