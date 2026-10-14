import { MigrationInterface, QueryRunner } from 'typeorm';

/** Add management names to every existing configuration without changing copy. */
export class AddWebsiteTemplateNames1791273600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE website_config_versions AS version
      SET config = jsonb_set(version.config, '{templates}', (
        SELECT jsonb_agg(
          CASE WHEN template ? 'name' THEN template
            ELSE template || jsonb_build_object('name', template->>'code') END
          ORDER BY position
        )
        FROM jsonb_array_elements(version.config->'templates')
          WITH ORDINALITY AS templates(template, position)
      ))
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(version.config->'templates') AS template
        WHERE NOT template ? 'name'
      )
    `);
  }

  async down(): Promise<void> {
    // Keep names: removing them would discard user-authored configuration data.
  }
}
