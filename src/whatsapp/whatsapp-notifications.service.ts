import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FeishuSendException, FeishuService } from '../feishu/feishu.service';
import { notificationEnabled } from '../notifications/notification-settings';
import {
  NotificationConversation,
  notificationSummary,
  whatsappRecipients,
  WhatsappNotificationType,
} from './whatsapp-notifications';
interface Job {
  id: string;
  batch_id: string;
  conversation_id: string;
  recipient_id: string;
  open_id: string;
  status: string;
  attempts: number;
}
interface Batch {
  id: string;
  created_at: Date;
  type: WhatsappNotificationType;
  owner_id: string | null;
  previous_owner_id: string | null;
  status: string;
  message_count: number;
  name: string;
  text: string | null;
  kind: string | null;
  occurred_at: Date | null;
}
@Injectable()
export class WhatsappNotificationsService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly logger = new Logger(WhatsappNotificationsService.name);
  constructor(
    private readonly db: DataSource,
    private readonly feishu: FeishuService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      if (!this.running)
        this.running = this.drain()
          .catch(() => this.logger.error('WhatsApp notification worker failed'))
          .finally(() => {
            this.running = undefined;
          });
    }, 1000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }
  async drain() {
    await this.db.query(
      `UPDATE whatsapp_notification_deliveries SET status='unknown',error_code='DELIVERY_OUTCOME_UNKNOWN' WHERE status='sending' AND claimed_at<now()-interval '2 minutes'`,
    );
    for (let n = 0; n < 20; n++) {
      const [candidate] = await this.db.query<Job[]>(
        `SELECT d.*,b.conversation_id FROM whatsapp_notification_deliveries d JOIN whatsapp_notification_batches b ON b.id=d.batch_id WHERE d.status='pending' AND d.next_attempt_at<=now() ORDER BY d.next_attempt_at,d.id LIMIT 1`,
      );
      if (!candidate) break;
      // Persist a claim before the network request. A crash never returns it to pending.
      const claimed = await this.db.transaction(async (manager) => {
        await manager.query(
          'SELECT id FROM whatsapp_conversations WHERE id=$1 FOR UPDATE',
          [candidate.conversation_id],
        );
        const [rows] = await manager.query<[Job[], number]>(
          `UPDATE whatsapp_notification_deliveries SET status='sending',claimed_at=now(),attempts=attempts+1 WHERE id=$1 AND status='pending' RETURNING *`,
          [candidate.id],
        );
        if (rows.length)
          await manager.query(
            `UPDATE whatsapp_notification_batches SET status='ready' WHERE id=$1 AND status='pending'`,
            [candidate.batch_id],
          );
        return !!rows.length;
      });
      if (!claimed) continue;
      await this.db.transaction(async (manager) => {
        const [c] = await manager.query<NotificationConversation[]>(
          'SELECT id,owner_id,state,version FROM whatsapp_conversations WHERE id=$1 FOR UPDATE',
          [candidate.conversation_id],
        );
        const [batch] = await manager.query<Batch[]>(
          `SELECT b.*,coalesce(nullif(p.manual_name,''),nullif(p.name,''),'未命名客户') AS name,m.text,m.kind,m.occurred_at
          FROM whatsapp_notification_batches b JOIN whatsapp_conversations c ON c.id=b.conversation_id JOIN whatsapp_contacts p ON p.id=c.contact_id LEFT JOIN whatsapp_messages m ON m.id=b.latest_message_id WHERE b.id=$1`,
          [candidate.batch_id],
        );
        const enabled = await notificationEnabled(
          manager,
          batch.type,
          true,
          batch.created_at,
        );
        const [job] = await manager.query<Job[]>(
          'SELECT * FROM whatsapp_notification_deliveries WHERE id=$1 FOR UPDATE',
          [candidate.id],
        );
        if (job.status !== 'sending') return;
        let reason: string | undefined;
        if (!enabled) reason = 'NOTIFICATION_DISABLED';
        else if (!c || c.state !== 'open' || batch.status !== 'ready')
          reason = 'CONVERSATION_INACTIVE';
        else if (c.owner_id !== batch.owner_id) reason = 'ASSIGNMENT_CHANGED';
        else if (!this.feishu.configured) reason = 'FEISHU_NOT_CONFIGURED';
        else {
          const recipients = await whatsappRecipients(manager, c.owner_id);
          // Same Open ID may belong to multiple eligible accounts; resolve it afresh without expanding the original audience.
          if (!recipients.some((row) => row.openId === job.open_id))
            reason = 'RECIPIENT_UNAVAILABLE';
        }
        if (reason) {
          await manager.query(
            `UPDATE whatsapp_notification_deliveries SET status='skipped',error_code=$2 WHERE id=$1`,
            [job.id, reason],
          );
          return;
        }
        const title =
          batch.type === 'whatsapp_assignment'
            ? batch.previous_owner_id
              ? '改派提醒'
              : '分配提醒'
            : batch.type === 'whatsapp_unassigned'
              ? '待分配'
              : '新消息待回复';
        const text = [
          `【WhatsApp ${title}】`,
          `客户：${notificationSummary(batch.name, 'text')}`,
          ...(batch.message_count
            ? [`新增消息：${batch.message_count}条`]
            : []),
          ...(batch.kind
            ? [`最新消息：${notificationSummary(batch.text ?? '', batch.kind)}`]
            : []),
          ...(batch.occurred_at
            ? [
                `收到时间：${batch.occurred_at.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）`,
              ]
            : []),
          batch.type === 'whatsapp_unassigned'
            ? '请进入系统分配负责人。'
            : batch.type === 'whatsapp_assignment'
              ? '咨询已分配给你，请查看并跟进。'
              : '客户有新消息，请查看并回复。',
          `查看会话：${this.feishu.conversationUrl(c.id)}`,
        ].join('\n');
        try {
          const result = await this.feishu.sendText(job.open_id, text, job.id);
          await manager.query(
            `UPDATE whatsapp_notification_deliveries SET status='sent',sent_at=now(),message_id=$2,error_code=NULL WHERE id=$1`,
            [job.id, result.messageId],
          );
        } catch (error) {
          const unknown =
            !(error instanceof FeishuSendException) || error.deliveryUnknown;
          const status = unknown
            ? 'unknown'
            : job.attempts >= 4
              ? 'failed'
              : 'pending';
          await manager.query(
            `UPDATE whatsapp_notification_deliveries SET status=$2,error_code=$3,next_attempt_at=now()+($4::int*interval '1 second') WHERE id=$1`,
            [
              job.id,
              status,
              unknown ? 'DELIVERY_OUTCOME_UNKNOWN' : 'FEISHU_SEND_FAILED',
              [30, 120, 480, 0][Math.min(job.attempts - 1, 3)],
            ],
          );
        }
      });
    }
  }
}
