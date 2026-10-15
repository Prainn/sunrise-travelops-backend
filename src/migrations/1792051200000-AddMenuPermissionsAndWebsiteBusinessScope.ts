import { MigrationInterface, QueryRunner } from 'typeorm';

/** Existing website IDs, configuration versions and frozen JSON remain unchanged. */
export class AddMenuPermissionsAndWebsiteBusinessScope1792051200000 implements MigrationInterface {
  name = 'AddMenuPermissionsAndWebsiteBusinessScope1792051200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE role_menu_configs (
        role_id uuid PRIMARY KEY REFERENCES roles(id),
        menu_keys text[] NOT NULL,
        version integer NOT NULL DEFAULT 1 CHECK(version > 0),
        updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE website_inquiries ADD COLUMN business_unit varchar(20) NOT NULL DEFAULT 'website'
        CHECK(business_unit IN ('linxi','website'));
      ALTER TABLE website_inquiries ALTER COLUMN business_unit DROP DEFAULT;
      ALTER TABLE website_inquiries ADD CONSTRAINT website_inquiries_business_id UNIQUE(business_unit,id);
      CREATE INDEX website_inquiries_business_owner_status ON website_inquiries(business_unit,owner_id,status,created_at DESC);
      ALTER TABLE website_config_versions ADD COLUMN business_unit varchar(20) NOT NULL DEFAULT 'website'
        CHECK(business_unit IN ('linxi','website'));
      ALTER TABLE website_config_versions ALTER COLUMN business_unit DROP DEFAULT;
      ALTER TABLE website_config_versions ADD CONSTRAINT website_config_business_version UNIQUE(business_unit,version);
      CREATE SEQUENCE website_config_version_seq AS integer;
      SELECT setval('website_config_version_seq', (SELECT max(version)+1 FROM website_config_versions), false);
      ALTER TABLE website_config_current DROP CONSTRAINT website_config_current_id_check;
      ALTER TABLE website_config_current ADD COLUMN business_unit varchar(20) NOT NULL DEFAULT 'website'
        CHECK(business_unit IN ('linxi','website'));
      ALTER TABLE website_config_current ALTER COLUMN business_unit DROP DEFAULT;
      ALTER TABLE website_config_current ADD CONSTRAINT website_config_current_business UNIQUE(business_unit);
      ALTER TABLE website_config_current ADD CONSTRAINT website_config_current_business_version
        FOREIGN KEY(business_unit,version) REFERENCES website_config_versions(business_unit,version);
      WITH initial AS (SELECT nextval('website_config_version_seq')::integer AS version),
        saved AS (INSERT INTO website_config_versions(version,business_unit,config)
          SELECT version,'linxi',jsonb_build_object('version',version,'cities','[]'::jsonb,'attractions','[]'::jsonb,
            'hotels','[]'::jsonb,'routes','[]'::jsonb,'patterns','[]'::jsonb,'skeletons','[]'::jsonb,'templates','[]'::jsonb)
          FROM initial RETURNING version)
      INSERT INTO website_config_current(id,business_unit,version) SELECT 2,'linxi',version FROM saved;
      ALTER TABLE website_itineraries ADD COLUMN business_unit varchar(20) NOT NULL DEFAULT 'website';
      ALTER TABLE website_itineraries ALTER COLUMN business_unit DROP DEFAULT;
      ALTER TABLE website_itineraries ADD CONSTRAINT website_itineraries_business_inquiry
        FOREIGN KEY(business_unit,inquiry_id) REFERENCES website_inquiries(business_unit,id);
      ALTER TABLE website_itineraries ADD CONSTRAINT website_itineraries_business_config
        FOREIGN KEY(business_unit,config_version) REFERENCES website_config_versions(business_unit,version);
    `);
    // Frozen initial menu definitions; do not import runtime permission code.
    const all = [
      'dict',
      'business-dict',
      'users',
      'operations',
      'menu-permissions',
      'inquiries',
      'inquiry-summary',
      'website-config',
      'agency',
      'city',
      'hotel',
      'restaurant',
      'attraction',
      'transport',
      'flight',
      'guide-people',
      'guide-leaves',
      'guide-ratings',
      'tours',
    ];
    const defaults: Record<string, string[]> = {
      ROOT: all,
      ADMIN: all.filter((key) => key !== 'menu-permissions'),
      EXECUTIVE: all.filter(
        (key) => !['menu-permissions', 'operations'].includes(key),
      ),
      BUSINESS_MANAGER: all.filter(
        (key) => !['dict', 'operations', 'menu-permissions'].includes(key),
      ),
      COORDINATOR: all.filter(
        (key) =>
          !['dict', 'users', 'operations', 'menu-permissions'].includes(key),
      ),
      RESOURCE_MANAGER: all.filter(
        (key) =>
          ![
            'dict',
            'users',
            'operations',
            'menu-permissions',
            'inquiries',
            'inquiry-summary',
            'guide-ratings',
            'tours',
          ].includes(key),
      ),
    };
    for (const [code, keys] of Object.entries(defaults))
      await q.query(
        'INSERT INTO role_menu_configs(role_id,menu_keys) SELECT id,$2::text[] FROM roles WHERE code=$1',
        [code, keys],
      );
    await q.query(
      "INSERT INTO permissions(code,name) VALUES ('sys:menu-permission:list','查看菜单权限'),('sys:menu-permission:update','配置菜单权限')",
    );
  }

  down(): Promise<void> {
    throw new Error(
      'Menu sessions and linxi business/configuration data require a reviewed recovery plan; automatic rollback is unsupported.',
    );
  }
}
