import { MigrationInterface, QueryRunner } from 'typeorm';
export class InquiryFollowUps1796083203000 implements MigrationInterface {
  name = 'InquiryFollowUps1796083203000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE inquiry_follow_ups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inquiry_id uuid NOT NULL REFERENCES inquiries(id),
      request_id uuid, remark text NOT NULL, next_follow_up_at timestamptz,
      reminder_days integer CHECK(reminder_days IN (1,3,5,15)),
      followed_at timestamptz, followed_by uuid, followed_by_name text,
      legacy boolean NOT NULL DEFAULT false, UNIQUE(inquiry_id,request_id),
      CHECK(legacy OR (followed_at IS NOT NULL AND followed_by IS NOT NULL AND followed_by_name IS NOT NULL)),
      CHECK(reminder_days IS NULL OR next_follow_up_at IS NOT NULL)
    );
    CREATE INDEX idx_inquiry_follow_ups ON inquiry_follow_ups(inquiry_id,followed_at DESC,id);
    INSERT INTO inquiry_follow_ups(inquiry_id,remark,next_follow_up_at,legacy)
      SELECT id,internal_remark,NULLIF(next_follow_up_at,'')::timestamptz,true FROM inquiries
      WHERE btrim(internal_remark)<>'' OR NULLIF(next_follow_up_at,'') IS NOT NULL;
    CREATE TABLE inquiry_follow_up_reminders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), follow_up_id uuid NOT NULL UNIQUE REFERENCES inquiry_follow_ups(id),
      inquiry_id uuid NOT NULL REFERENCES inquiries(id), due_at timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','cancelled')),
      recipient_id uuid, sent_at timestamptz, message_id text, error_code text,
      delivery_unknown boolean NOT NULL DEFAULT false, claimed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_inquiry_follow_reminders_due ON inquiry_follow_up_reminders(due_at,id) WHERE status='pending';`);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Follow-up history and delivery audit must be retained; restore reviewed matching backup',
      ),
    );
  }
}
