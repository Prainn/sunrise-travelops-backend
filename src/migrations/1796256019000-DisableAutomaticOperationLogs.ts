import { MigrationInterface, QueryRunner } from 'typeorm';

// The job tables retain their own state and retry history.
const jobTables = [
  'inquiry_follow_up_reminders',
  'feishu_ledger_notifications',
  'whatsapp_notification_batches',
  'whatsapp_notification_deliveries',
  'whatsapp_events',
  'whatsapp_messages',
  'oss_resources',
  'whatsapp_documents',
  'whatsapp_document_archives',
];

export class DisableAutomaticOperationLogs1796256019000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    for (const table of jobTables)
      await runner.query(
        `ALTER TABLE ${table} DISABLE TRIGGER audit_job_transition`,
      );
  }

  async down(runner: QueryRunner) {
    for (const table of jobTables)
      await runner.query(
        `ALTER TABLE ${table} ENABLE TRIGGER audit_job_transition`,
      );
  }
}
