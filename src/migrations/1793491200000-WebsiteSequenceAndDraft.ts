import { MigrationInterface, QueryRunner } from 'typeorm';

/** Coordinate with the application release: removed guide fields are not backward compatible. */
export class WebsiteSequenceAndDraft1793491200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE website_itineraries ADD COLUMN reorder_draft jsonb;
      ALTER TABLE website_days ADD COLUMN event_order text[] NOT NULL DEFAULT '{}';
      ALTER TABLE website_days DROP COLUMN guide_scope;
      ALTER TABLE website_days DROP CONSTRAINT website_days_active_cities_check;
    `);
    for (const table of [
      'website_items',
      'website_legs',
      'website_meals',
      'website_services',
    ]) {
      await q.query(
        `UPDATE ${table} SET fee_state='INCLUDED' WHERE fee_state='ARRANGED'`,
      );
      await q.query(
        `ALTER TABLE ${table} DROP CONSTRAINT ${table}_fee_state_check`,
      );
      await q.query(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_fee_state_check
        CHECK(fee_state IN ('INCLUDED','EXCLUDED','OPTIONAL','RECOMMENDED','SELF_PAY','UNKNOWN'))`);
    }
    // Configurations are structured documents. Frozen quotation/audit snapshots remain untouched.
    await q.query(`UPDATE website_config_versions v SET config =
      jsonb_set(jsonb_set(v.config, '{routes}', COALESCE((
        SELECT jsonb_agg(CASE WHEN r->>'feeState'='ARRANGED' THEN jsonb_set(r,'{feeState}','"INCLUDED"') ELSE r END ORDER BY n)
        FROM jsonb_array_elements(v.config->'routes') WITH ORDINALITY a(r,n)
      ), '[]'::jsonb)), '{templates}', COALESCE((
        SELECT jsonb_agg(CASE WHEN t->>'code'='guide' THEN
          jsonb_set(jsonb_set(t,'{zh}',to_jsonb(btrim(replace(t->>'zh','{service_scope}','')))),
            '{en}',to_jsonb(btrim(replace(t->>'en','{service_scope}','')))) ELSE t END ORDER BY n)
        FROM jsonb_array_elements(v.config->'templates') WITH ORDINALITY a(t,n)
      ), '[]'::jsonb))`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Restore the pre-migration backup and matching application; removed guide scope and fee-state conversions are irreversible.',
      ),
    );
  }
}
