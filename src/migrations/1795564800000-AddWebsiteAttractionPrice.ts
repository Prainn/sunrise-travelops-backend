import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebsiteAttractionPrice1795564800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Keep every configuration version and its ordering; only add missing prices.
    await q.query(`UPDATE website_config_versions v SET config=jsonb_set(config,'{attractions}',
      (SELECT jsonb_agg(CASE WHEN a.item ? 'price' THEN a.item
        ELSE a.item || '{"price":"0.00"}'::jsonb END ORDER BY a.position)
       FROM jsonb_array_elements(v.config->'attractions') WITH ORDINALITY a(item,position)))
      WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v.config->'attractions') a WHERE NOT (a ? 'price'))`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Retain attraction prices when rolling back the application'),
    );
  }
}
