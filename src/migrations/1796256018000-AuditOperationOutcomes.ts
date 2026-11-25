import { MigrationInterface, QueryRunner } from 'typeorm';

// Freeze these bindings with the migration. Only identifiers and job states enter the audit.
const tasks = [
  {
    table: 'inquiry_follow_up_reminders',
    state: 'status',
    category: 'inquiry',
    action: '发送询盘跟进提醒',
    scope: '(SELECT business_unit FROM inquiries WHERE id=NEW.inquiry_id)',
    parent: 'inquiry_id',
    unknown: 'NEW.delivery_unknown',
  },
  {
    table: 'feishu_ledger_notifications',
    state: 'status',
    category: 'ledger',
    action: '发送台账通知',
    scope: '(SELECT business_unit FROM direct_ledgers WHERE id=NEW.ledger_id)',
    parent: 'ledger_id',
    attempts: true,
  },
  {
    table: 'whatsapp_notification_batches',
    state: 'status',
    category: 'whatsapp',
    action: '处理WhatsApp通知批次',
    scope: "'website'",
  },
  {
    table: 'whatsapp_notification_deliveries',
    state: 'status',
    category: 'whatsapp',
    action: '发送WhatsApp飞书通知',
    scope: "'website'",
    parent: 'batch_id',
    attempts: true,
  },
  {
    table: 'whatsapp_events',
    state: 'state',
    category: 'whatsapp',
    action: '处理WhatsApp接收事件',
    scope: "'website'",
    attempts: true,
  },
  {
    table: 'whatsapp_messages',
    state: 'status',
    category: 'whatsapp',
    action: '更新WhatsApp消息收发状态',
    scope: "'website'",
    parent: 'conversation_id',
    attempts: true,
  },
  {
    table: 'oss_resources',
    state: 'state',
    category: 'resource',
    action: '处理OSS媒体资源',
    scope:
      "CASE WHEN NEW.conversation_id IS NULL THEN 'system' ELSE 'website' END",
    attempts: true,
    cleanup: true,
  },
  {
    table: 'whatsapp_documents',
    state: 'state',
    category: 'whatsapp',
    action: '处理WhatsApp文件草稿',
    scope: "'website'",
    parent: 'conversation_id',
    cleanup: true,
  },
  {
    table: 'whatsapp_document_archives',
    state: 'state',
    category: 'whatsapp',
    action: '归档WhatsApp文件',
    scope: "'website'",
    key: 'message_id',
    attempts: true,
  },
];

export class AuditOperationOutcomes1796256018000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`ALTER TABLE operation_logs ADD COLUMN result varchar(12)
      CHECK (result IN ('success','failure','denied','cancelled','unknown','pending'))`);
    for (const job of tasks) {
      const column = job.state;
      const key = job.key ?? 'id';
      const fn = 'audit_job_' + job.table;
      const attempts = job.attempts ? 'NEW.attempts' : 'NULL::int';
      const sameAttempt = job.attempts ? 'AND OLD.attempts = NEW.attempts' : '';
      const deleted = job.cleanup
        ? `IF TG_OP='DELETE' THEN
        INSERT INTO operation_logs(category,action,success,result,actor_name,scope,detail)
        VALUES ('${job.category}','${job.action}',true,'success','系统任务',${job.scope.replaceAll('NEW.', 'OLD.')},
          jsonb_build_object('source','worker','recordId',OLD.${key},'from',OLD.${column},'to','deleted')::text);
        RETURN OLD;
      END IF;`
        : '';
      await runner.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE previous text; outcome text;
        BEGIN
          ${deleted}
          IF TG_OP='UPDATE' THEN
            previous := OLD.${column};
            IF previous=NEW.${column} ${sameAttempt} THEN RETURN NEW; END IF;
          END IF;
          outcome := CASE
            WHEN ${job.unknown ?? 'false'} OR NEW.${column}='unknown' THEN 'unknown'
            WHEN NEW.${column}='failed' OR (NEW.${column}='pending' AND previous IS NOT NULL
              AND (previous IN ('processing','sending') OR (previous='pending' AND ${attempts}>0))) THEN 'failure'
            WHEN NEW.${column} IN ('cancelled','skipped') THEN 'cancelled'
            WHEN NEW.${column} IN ('pending','sending','queued','uploading','deleting','processing','accepted') THEN 'pending'
            ELSE 'success' END;
          INSERT INTO operation_logs(category,action,success,result,actor_name,scope,detail)
          VALUES ('${job.category}','${job.action}',outcome='success',outcome,'系统任务',coalesce(${job.scope},'system'),
            jsonb_strip_nulls(jsonb_build_object('source','worker','recordId',NEW.${key},'from',previous,
              'to',NEW.${column},'attempt',${attempts},'parentId',${job.parent ? 'NEW.' + job.parent : 'NULL::uuid'}))::text);
          RETURN NEW;
        END $$;
        CREATE TRIGGER audit_job_transition AFTER INSERT OR UPDATE OF ${column}${job.attempts ? ',attempts' : ''}${job.cleanup ? ' OR DELETE' : ''}
        ON ${job.table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    }
  }

  async down(runner: QueryRunner) {
    await runner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM operation_logs WHERE result IS NOT NULL) THEN
        RAISE EXCEPTION 'Operation outcomes are in use; keep the compatible schema when rolling back the application';
      END IF;
    END $$`);
    for (const { table } of tasks) {
      await runner.query(
        `DROP TRIGGER audit_job_transition ON ${table}; DROP FUNCTION audit_job_${table}()`,
      );
    }
    await runner.query('ALTER TABLE operation_logs DROP COLUMN result');
  }
}
