import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FeishuService } from '../feishu/feishu.service';

interface Job {
  id: string;
  inquiry_id: string;
  follow_up_id: string;
  status: string;
  claimed_at: Date | null;
}
interface Recipient {
  id: string;
  openId: string;
}
@Injectable()
export class InquiryRemindersService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly logger = new Logger(InquiryRemindersService.name);
  constructor(
    private readonly db: DataSource,
    private readonly feishu: FeishuService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      if (!this.running)
        this.running = this.drain()
          .catch(() => this.logger.error('Inquiry reminder worker failed'))
          .finally(() => {
            this.running = undefined;
          });
    }, 5000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }
  async availability(manager: EntityManager, inquiryId: string) {
    if (!this.feishu.configured)
      return {
        available: false,
        reason: 'FEISHU_NOT_CONFIGURED',
        recipientId: null,
      };
    const recipient = await this.recipient(manager, inquiryId);
    return {
      available: !!recipient,
      reason: recipient ? null : 'FOLLOW_UP_RECIPIENT_UNAVAILABLE',
      recipientId: recipient?.id ?? null,
    };
  }
  private async recipient(
    manager: EntityManager,
    inquiryId: string,
  ): Promise<Recipient | undefined> {
    const [row] = await manager.query<Recipient[]>(
      `SELECT u.id,u.feishu_open_id AS "openId" FROM inquiries q JOIN users u ON u.id=q.owner_id
      WHERE q.id=$1 AND u.status='enabled' AND u.deleted_at IS NULL AND btrim(u.feishu_open_id)<>'' AND EXISTS(
        SELECT 1 FROM user_identities i JOIN identity_roles ir ON ir.identity_id=i.id JOIN roles r ON r.id=ir.role_id
        WHERE i.user_id=u.id AND i.scope=q.business_unit AND r.is_enabled AND r.code='COORDINATOR')`,
      [inquiryId],
    );
    return row;
  }
  async drain() {
    // A persisted claim survives process death. Ambiguous deliveries are never automatically resent.
    await this.db.query(
      `UPDATE inquiry_follow_up_reminders SET status='failed',delivery_unknown=true,error_code='DELIVERY_OUTCOME_UNKNOWN',updated_at=now() WHERE status='sending' AND claimed_at<now()-interval '2 minutes'`,
    );
    for (let n = 0; n < 10; n++) {
      const candidate = await this.db.query<Job[]>(
        `SELECT * FROM inquiry_follow_up_reminders WHERE status='pending' AND due_at<=now() ORDER BY due_at,id LIMIT 1`,
      );
      if (!candidate[0]) break;
      const job = candidate[0];
      const claimed = await this.db.transaction(async (manager) => {
        await manager.query('SELECT id FROM inquiries WHERE id=$1 FOR UPDATE', [
          job.inquiry_id,
        ]);
        const rows = await manager.query<Job[]>(
          `UPDATE inquiry_follow_up_reminders SET status='sending',claimed_at=now(),updated_at=now() WHERE id=$1 AND status='pending' RETURNING *`,
          [job.id],
        );
        return !!rows.length;
      });
      if (!claimed) continue;
      await this.db.transaction(async (manager) => {
        const [inquiry] = await manager.query<
          {
            id: string;
            code: string;
            status: string;
            deleted_at: Date | null;
            next_follow_up_at: string | null;
          }[]
        >('SELECT * FROM inquiries WHERE id=$1 FOR UPDATE', [job.inquiry_id]);
        const [current] = await manager.query<Job[]>(
          'SELECT * FROM inquiry_follow_up_reminders WHERE id=$1 FOR UPDATE',
          [job.id],
        );
        if (current?.status !== 'sending') return;
        if (
          !inquiry ||
          inquiry.deleted_at ||
          ['lost', 'archived'].includes(inquiry.status)
        ) {
          await manager.query(
            `UPDATE inquiry_follow_up_reminders SET status='cancelled',updated_at=now() WHERE id=$1`,
            [job.id],
          );
          return;
        }
        const recipient = await this.recipient(manager, job.inquiry_id);
        if (!this.feishu.configured || !recipient) {
          await manager.query(
            `UPDATE inquiry_follow_up_reminders SET status='failed',error_code=$2,updated_at=now() WHERE id=$1`,
            [
              job.id,
              this.feishu.configured
                ? 'FOLLOW_UP_RECIPIENT_UNAVAILABLE'
                : 'FEISHU_NOT_CONFIGURED',
            ],
          );
          return;
        }
        await manager.query(
          'UPDATE inquiry_follow_up_reminders SET recipient_id=$2 WHERE id=$1',
          [job.id, recipient.id],
        );
        const when = inquiry.next_follow_up_at
          ? new Date(inquiry.next_follow_up_at).toLocaleString('zh-CN', {
              timeZone: 'Asia/Shanghai',
              hour12: false,
            })
          : '';
        try {
          const { messageId } = await this.feishu.sendText(
            recipient.openId,
            `询盘跟进提醒\n询盘：${inquiry.code}\n下次跟进：${when}\n请登录系统查看跟进记录。`,
            job.id,
          );
          await manager.query(
            `UPDATE inquiry_follow_up_reminders SET status='sent',sent_at=now(),message_id=$2,error_code=NULL,updated_at=now() WHERE id=$1`,
            [job.id, messageId],
          );
        } catch {
          await manager.query(
            `UPDATE inquiry_follow_up_reminders SET status='failed',delivery_unknown=true,error_code='DELIVERY_OUTCOME_UNKNOWN',updated_at=now() WHERE id=$1`,
            [job.id],
          );
        }
      });
    }
  }
}
