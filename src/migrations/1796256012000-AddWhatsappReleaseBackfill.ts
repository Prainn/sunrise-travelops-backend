import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsappReleaseBackfill1796256012000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE whatsapp_backfill_runs (
        account_id uuid NOT NULL REFERENCES whatsapp_accounts(id),
        release_key text NOT NULL,
        started_at timestamptz NOT NULL,
        until_at timestamptz NOT NULL CHECK (until_at >= started_at),
        next_at timestamptz,
        finished_at timestamptz,
        scanned integer NOT NULL DEFAULT 0,
        queued integer NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, release_key)
      );
      CREATE TABLE whatsapp_backfill_reviews (
        account_id uuid NOT NULL,
        release_key text NOT NULL,
        item_key text NOT NULL,
        provider_id text,
        occurred_at timestamptz,
        reason text NOT NULL,
        message_type text,
        window_start timestamptz NOT NULL,
        window_end timestamptz NOT NULL CHECK (window_end >= window_start),
        PRIMARY KEY (account_id, item_key),
        FOREIGN KEY (account_id, release_key) REFERENCES whatsapp_backfill_runs(account_id, release_key)
      );
      CREATE INDEX whatsapp_inbound_event_provider ON whatsapp_events (account_id, (payload->>'MessageId'))
        WHERE kind='inbound';
    `);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM whatsapp_backfill_runs) THEN
        RAISE EXCEPTION 'Refusing rollback with WhatsApp backfill history; retain progress and review items';
      END IF;
      END $$;
      DROP INDEX whatsapp_inbound_event_provider;
      DROP TABLE whatsapp_backfill_reviews, whatsapp_backfill_runs`);
  }
}
