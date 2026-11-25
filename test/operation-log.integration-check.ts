import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationLogsService } from '../src/operation-logs/operation-logs.service';
import { OperationLogEntity } from '../src/operation-logs/operation-log.entity';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AuditOperationOutcomes1796256018000 } from '../src/migrations/1796256018000-AuditOperationOutcomes';
import { IsolationHarness, type Actor } from './business-isolation.harness';

interface AuditRow {
  id: string;
  category: string;
  action: string;
  actor_name: string;
  actor_id: string | null;
  scope: string | null;
  result: string | null;
  detail: string;
  time: Date;
}
function detail(row: AuditRow): Record<string, unknown> {
  return JSON.parse(row.detail) as Record<string, unknown>;
}

async function verifyOtherJobs(
  h: IsolationHarness,
  account: string,
  user: Actor,
) {
  const [country] = await h.db.query<{ id: string }[]>(
    `INSERT INTO system_business_dictionary_items(type_id,name,english_name,code)
     SELECT id,'审计测试','Audit','AUDIT' FROM system_business_dictionary_types WHERE code='country-region' RETURNING id`,
  );
  const inquiry = await h.call<{ id: string; version: number }>(
    user,
    'POST',
    '/inquiries',
    { isSeries: true, countryItemId: country.id },
    201,
  );
  await h.call(
    user,
    'POST',
    `/inquiries/${inquiry.id}/follow-ups`,
    {
      version: inquiry.version,
      requestId: randomUUID(),
      remark: 'isolated private input',
      nextFollowUpAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      reminderDays: 1,
    },
    201,
  );
  await h.db.transaction(async (manager) => {
    const insert = async (sql: string, params: unknown[]) =>
      (await manager.query<{ id: string }[]>(sql + ' RETURNING id', params))[0]
        .id;
    await manager.query(
      "UPDATE inquiry_follow_up_reminders SET status='failed',delivery_unknown=true WHERE inquiry_id=$1",
      [inquiry.id],
    );
    const ledger = await insert(
      `INSERT INTO direct_ledgers(business_unit,received_date,source,creator_id,creator_name,operator_id,operator_name,receiving_account_name,updated_by)
      VALUES('website',current_date,'fixture',$1,'Audit',$1,'Audit','独立站',$1)`,
      [user.id],
    );
    await manager.query(
      `INSERT INTO feishu_ledger_notifications(ledger_id,ledger_version,kind,recipient_id,status)
      VALUES($1,1,'review',$2,'skipped')`,
      [ledger, user.id],
    );
    const contact = await insert(
      'INSERT INTO whatsapp_contacts(account_id) VALUES($1)',
      [account],
    );
    const conv = await insert(
      'INSERT INTO whatsapp_conversations(account_id,contact_id) VALUES($1,$2)',
      [account, contact],
    );
    const message = await insert(
      `INSERT INTO whatsapp_messages(account_id,conversation_id,direction,source,kind,status,occurred_at,text)
      VALUES($1,$2,'inbound','customer','document','received',now(),'isolated private input')`,
      [account, conv],
    );
    const batch = await insert(
      `INSERT INTO whatsapp_notification_batches(conversation_id,type,due_at,status)
      VALUES($1,'whatsapp_unassigned',now(),'cancelled')`,
      [conv],
    );
    await manager.query(
      `INSERT INTO whatsapp_notification_deliveries(batch_id,recipient_id,open_id,next_attempt_at,status)
      VALUES($1,$2,'isolated private input',now(),'unknown')`,
      [batch, user.id],
    );
    const media = await insert(
      `INSERT INTO oss_resources(environment,name,kind,source,state)
      VALUES('dev','isolated private input','image','management','deleting')`,
      [],
    );
    await manager.query('DELETE FROM oss_resources WHERE id=$1', [media]);
    const doc = await insert(
      `INSERT INTO whatsapp_documents(id,conversation_id,actor_identity_id,file_name,extension,mime_type,size_bytes,state)
      VALUES(gen_random_uuid(),$1,$2,'isolated private input','pdf','application/pdf',1,'deleting')`,
      [conv, user.identityId],
    );
    await manager.query('DELETE FROM whatsapp_documents WHERE id=$1', [doc]);
    await manager.query(
      `INSERT INTO whatsapp_document_archives(message_id,environment,state)
      VALUES($1,'dev','failed')`,
      [message],
    );
    const rows = await manager.query<AuditRow[]>(
      "SELECT * FROM operation_logs WHERE actor_name='系统任务'",
    );
    for (const [action, scope, result, state] of [
      ['发送询盘跟进提醒', 'shengxu', 'unknown', 'failed'],
      ['发送台账通知', 'website', 'cancelled', 'skipped'],
      ['更新WhatsApp消息收发状态', 'website', 'success', 'received'],
      ['处理WhatsApp通知批次', 'website', 'cancelled', 'cancelled'],
      ['发送WhatsApp飞书通知', 'website', 'unknown', 'unknown'],
      ['处理OSS媒体资源', 'system', 'success', 'deleted'],
      ['处理WhatsApp文件草稿', 'website', 'success', 'deleted'],
      ['归档WhatsApp文件', 'website', 'failure', 'failed'],
    ]) {
      assert(
        rows.some(
          (row) =>
            row.action === action &&
            row.scope === scope &&
            row.result === result &&
            detail(row).to === state,
        ),
        action,
      );
    }
    assert(!JSON.stringify(rows).includes('isolated private input'));
  });
}

async function main() {
  const retryDir = await mkdtemp(join(tmpdir(), 'sunrise-audit-test-'));
  process.env.OPERATION_LOG_RETRY_DIR = retryDir;
  const h = new IsolationHarness({}, { operationAudit: true });
  try {
    await h.start();
    const migration = new AuditOperationOutcomes1796256018000();
    const qr = h.db.createQueryRunner();
    const legacyId = randomUUID();
    try {
      await qr.startTransaction();
      await migration.down(qr);
      await qr.query(
        "INSERT INTO operation_logs(id,category,action,success,actor_name,scope) VALUES ($1,'user','历史操作',true,'',null)",
        [legacyId],
      );
      await migration.up(qr);
      await qr.commitTransaction();
    } finally {
      await qr.release();
    }
    const admin = await h.actor('headquarters', 'ADMIN');
    const user = await h.actor('shengxu');
    const base = '/system/operation-logs';
    const post = base + '/client-events';
    const rows = () =>
      h.db.query<AuditRow[]>('SELECT * FROM operation_logs ORDER BY time,id');
    await h.call(user, 'GET', '/auth/me');
    await h.call(undefined, 'GET', base, undefined, 401, 'AUTH_TOKEN_INVALID');
    await h.call(user, 'GET', base, undefined, 403, 'AUTH_FORBIDDEN');
    await h.call(
      user,
      'POST',
      '/auth/switch-account',
      { targetUserId: randomUUID() },
      403,
      'AUTH_FORBIDDEN',
    );
    const event = {
      eventId: randomUUID(),
      page: 'InquiryList',
      action: 'cancel',
      result: 'cancelled',
      occurredAt: new Date().toISOString(),
    };
    await Promise.all([
      h.call(user, 'POST', post, event, 204),
      h.call(user, 'POST', post, event, 204),
    ]);
    await h.call(
      user,
      'POST',
      post,
      {
        ...event,
        actorName: 'forged',
        scope: 'headquarters',
        detail: 'audit-sensitive-test',
      },
      400,
      'VALIDATION_ERROR',
    );
    await h.call(
      undefined,
      'POST',
      post,
      {
        ...event,
        page: 'Login',
        action: 'language',
        result: 'success',
        value: 'en',
      },
      204,
    );
    await h.call(undefined, 'POST', post, event, 401, 'AUTH_TOKEN_INVALID');
    await h.call(
      undefined,
      'POST',
      post,
      {
        ...event,
        eventId: randomUUID(),
        page: 'Unavailable',
        action: 'retry',
      },
      204,
    );
    const rejectedCredential = await fetch(h.url + post, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer invalid-fixture',
      },
      body: JSON.stringify({ ...event, page: 'Login', action: 'open' }),
    });
    assert.equal(rejectedCredential.status, 401);
    const invalid = await fetch(h.url + post, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"broken',
    });
    assert.equal(invalid.status, 400);
    const data = await rows();
    for (const row of data.filter((r) => r.id !== legacyId)) {
      assert(
        row.time instanceof Date &&
          row.actor_name &&
          row.scope &&
          row.category &&
          row.action &&
          row.result &&
          Object.keys(detail(row)).length,
      );
    }
    assert(
      data.some(
        (r) =>
          r.action === '登录' &&
          r.actor_id === user.id &&
          r.scope === 'shengxu',
      ),
    );
    assert(
      data.some((r) => r.action.includes('当前身份') && r.actor_id === user.id),
    );
    assert(
      data.some(
        (r) =>
          r.result === 'denied' &&
          r.actor_id === user.id &&
          detail(r).stage === 'guard',
      ),
    );
    assert(data.some((r) => r.result === 'denied' && r.scope === 'unknown'));
    assert.equal(
      data.filter((r) => r.action === '切换账号' && r.result === 'denied')
        .length,
      1,
    );
    assert.equal(
      data.filter((r) => r.category === 'client' && r.actor_id === user.id)
        .length,
      1,
    );
    assert(data.some((r) => r.action === '接口路由或请求解析失败'));
    assert(!JSON.stringify(data).includes('audit-sensitive-test'));
    type Page = {
      list: { id: string; result: string }[];
      total: number;
      snapshotAt: string;
    };
    const page = await h.call<Page>(admin, 'GET', base + '?pageSize=1');
    const second = await h.call<Page>(
      admin,
      'GET',
      base +
        '?page=2&pageSize=1&snapshotAt=' +
        encodeURIComponent(page.snapshotAt),
    );
    assert.equal(second.total, page.total);
    assert.notEqual(second.list[0].id, page.list[0].id);
    const legacy = await h.call<Page>(admin, 'GET', base + '?pageSize=100');
    assert.equal(legacy.list.find((r) => r.id === legacyId)?.result, 'success');
    assert.equal(data.find((r) => r.id === legacyId)?.scope, null);
    // Actual job states are persisted by PostgreSQL even when the writer is not an HTTP handler.
    const account = randomUUID(),
      id = randomUUID();
    await h.db.query(
      "INSERT INTO whatsapp_accounts(id,space_id,waba_id,phone) VALUES ($1,'iso','iso','iso')",
      [account],
    );
    await h.db.query(
      "INSERT INTO whatsapp_events(id,account_id,event_key,payload,kind) VALUES ($1,$2,'audit-fixture','{}','inbound')",
      [id, account],
    );
    await h.db.query(
      "UPDATE whatsapp_events SET state='pending',attempts=attempts+1 WHERE id=$1",
      [id],
    );
    await h.db.query(
      "UPDATE whatsapp_events SET state='done',attempts=attempts+1 WHERE id=$1",
      [id],
    );
    await h.db.query("UPDATE whatsapp_events SET state='done' WHERE id=$1", [
      id,
    ]);
    await assert.rejects(
      h.db.transaction(async (manager) => {
        await manager.query(
          "UPDATE whatsapp_events SET state='failed' WHERE id=$1",
          [id],
        );
        throw new Error('isolated rollback');
      }),
      /isolated rollback/,
    );
    const jobs = (await rows()).filter(
      (r) => r.actor_name === '系统任务' && detail(r).recordId === id,
    );
    assert.deepEqual(
      jobs.map((r) => r.result),
      ['pending', 'failure', 'success'],
    );
    assert(jobs.every((r) => r.scope === 'website'));
    await verifyOtherJobs(h, account, user);
    const durableId = randomUUID(),
      happenedAt = new Date('2026-11-01T12:00:00Z');
    await h.db
      .query(`CREATE FUNCTION test_audit_unavailable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='isolated-journal-test' THEN RAISE EXCEPTION 'isolated failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_unavailable BEFORE INSERT ON operation_logs FOR EACH ROW EXECUTE FUNCTION test_audit_unavailable()`);
    await h.get(OperationLogsService).append([
      {
        id: durableId,
        time: happenedAt,
        category: 'system',
        action: 'isolated-journal-test',
        scope: 'system',
        actorId: null,
        actorName: '系统任务',
        success: true,
        result: 'success',
        detail: '{"source":"worker"}',
        ip: null,
      },
    ]);
    assert((await readdir(retryDir)).some((name) => name.endsWith('.json')));
    await h.db.query('DROP TRIGGER test_unavailable ON operation_logs');
    const restarted = new OperationLogsService(
      h.db.getRepository(OperationLogEntity),
    );
    restarted.onModuleInit();
    await restarted.onModuleDestroy();
    assert.equal((await readdir(retryDir)).length, 0);
    const restored = await h.db
      .getRepository(OperationLogEntity)
      .findOneByOrFail({ id: durableId });
    assert.equal(restored.time.toISOString(), happenedAt.toISOString());
    process.stdout.write(
      `PASS: isolated upgrade, ${h.requests + 2} HTTP calls, seven fields, deduplication, rejected requests, pagination, nine transactional worker tables and durable replay.\n`,
    );
  } finally {
    await h.close();
    await rm(retryDir, { recursive: true, force: true });
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
