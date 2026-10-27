import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFeishuNotifications1794009600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users ADD COLUMN feishu_open_id varchar(100) NOT NULL DEFAULT ''
      CHECK(feishu_open_id='' OR feishu_open_id ~ '^ou_[A-Za-z0-9_-]{1,97}$');
      CREATE TABLE feishu_ledger_notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ledger_id uuid NOT NULL REFERENCES direct_ledgers(id) ON DELETE CASCADE,
        ledger_version integer NOT NULL CHECK(ledger_version>0),
        kind text NOT NULL CHECK(kind IN ('review','operate')),
        recipient_id uuid NOT NULL REFERENCES users(id),
        status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','skipped','failed')),
        attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 4),
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        message_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(ledger_id,ledger_version,kind,recipient_id)
      );
      CREATE INDEX ON feishu_ledger_notifications(next_attempt_at) WHERE status='pending';`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Retain account bindings and notification delivery records; use a reviewed recovery plan',
      ),
    );
  }
}
