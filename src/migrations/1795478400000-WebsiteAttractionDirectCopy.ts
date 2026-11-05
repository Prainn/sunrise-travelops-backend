import { MigrationInterface, QueryRunner } from 'typeorm';

export class WebsiteAttractionDirectCopy1795478400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Convert every bound configuration version without rewriting itineraries or frozen quotes.
    await q.query(`DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM website_config_versions v,
          jsonb_array_elements(v.config->'attractions') a
        WHERE a ? 'copyKey' AND (
          (SELECT count(*) FROM jsonb_array_elements(v.config->'templates') t
            WHERE t->>'code'=a->>'copyKey') <> 1
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(v.config->'templates') t
            WHERE t->>'code'=a->>'copyKey' AND (
              jsonb_typeof(t->'zh') IS DISTINCT FROM 'string'
              OR jsonb_typeof(t->'en') IS DISTINCT FROM 'string'
              OR t->>'status'<>'enabled'
              OR (a ? 'descriptionZh' AND a->'descriptionZh' IS DISTINCT FROM t->'zh')
              OR (a ? 'descriptionEn' AND a->'descriptionEn' IS DISTINCT FROM t->'en')
            ))
        )
      ) THEN RAISE EXCEPTION 'Attraction copy is missing, ambiguous, disabled or conflicting; review before migration'; END IF;
      IF EXISTS (
        SELECT 1 FROM website_config_versions v,
          jsonb_array_elements(v.config->'attractions') a
        WHERE NOT (a ? 'copyKey') AND (
          jsonb_typeof(a->'descriptionZh') IS DISTINCT FROM 'string'
          OR jsonb_typeof(a->'descriptionEn') IS DISTINCT FROM 'string'
        )
      ) THEN RAISE EXCEPTION 'Attraction direct copy is incomplete; review before migration'; END IF;
    END $$`);
    await q.query(`UPDATE website_config_versions v SET config=jsonb_set(config,'{attractions}',
      (SELECT jsonb_agg(CASE WHEN a.item ? 'copyKey' THEN
        (a.item-'copyKey') || (SELECT jsonb_build_object('descriptionZh',t->'zh','descriptionEn',t->'en')
          FROM jsonb_array_elements(v.config->'templates') t WHERE t->>'code'=a.item->>'copyKey')
        ELSE a.item END ORDER BY a.position)
       FROM jsonb_array_elements(v.config->'attractions') WITH ORDINALITY a(item,position)))
      WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v.config->'attractions') a WHERE a ? 'copyKey')`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Attraction direct copy requires the reviewed database backup and matching application to recover',
      ),
    );
  }
}
