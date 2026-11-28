import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { directDeliveryFailure } from '../feishu/direct-delivery-failure';
import { FeishuService } from '../feishu/feishu.service';
import { formatMailUnassignedReminder } from '../feishu/mail-reminder';
import { notificationPolicy } from '../notifications/notification-settings';
import { websiteNotificationRecipients } from '../notifications/website-notification-recipients';

interface MailDelivery {
  id: string;
  thread_id: string;
  attempts: number;
  open_id: string;
  created_at: Date;
  first_message_id: string;
}

@Injectable()
export class MailNotificationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly logger = new Logger(MailNotificationsService.name);

  constructor(
    private readonly db: DataSource,
    private readonly feishu: FeishuService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.running ??= this.drain()
        .catch(() => this.logger.error('Mail notification worker failed'))
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
      `UPDATE mail_notification_deliveries SET status='unknown',error_code='DELIVERY_OUTCOME_UNKNOWN'
       WHERE status='sending' AND claimed_at<now()-interval '2 minutes'`,
    );
    for (let n = 0; n < 20; n++) {
      const [[job]] = await this.db.query<[MailDelivery[], number]>(
        `WITH candidate AS (SELECT id FROM mail_notification_deliveries WHERE status='pending' AND digest_at IS NULL
          AND next_attempt_at<=now() ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
         UPDATE mail_notification_deliveries d SET status='sending',claimed_at=now(),attempts=attempts+1
         FROM candidate c WHERE d.id=c.id RETURNING d.*`,
      );
      if (!job) break;
      await this.db.transaction(async (manager) => {
        // Serialize the eligibility check and send with assigning the thread, as in WhatsApp.
        const [thread] = await manager.query<
          { mailbox: string; name: string; owner_id: string | null }[]
        >(
          `SELECT mailbox,coalesce(nullif(manual_customer_name,''),nullif(customer_name,''),customer_email) AS name,owner_id
           FROM mail_threads WHERE id=$1 AND has_inbound FOR UPDATE`,
          [job.thread_id],
        );
        const policy = await notificationPolicy(
          manager,
          'mail_unassigned',
          job.created_at,
        );
        const [claimed] = await manager.query<{ id: string }[]>(
          `SELECT id FROM mail_notification_deliveries WHERE id=$1 AND status='sending' FOR UPDATE`,
          [job.id],
        );
        if (!claimed) return;
        let reason: string | undefined;
        if (!policy.enabled) reason = 'NOTIFICATION_DISABLED';
        else if (!thread || thread.owner_id) reason = 'ASSIGNMENT_CHANGED';
        else if (!this.feishu.configured) reason = 'FEISHU_NOT_CONFIGURED';
        else {
          const recipients = await websiteNotificationRecipients(
            manager,
            null,
            'mail:thread:list',
          );
          if (!recipients.some((row) => row.openId === job.open_id))
            reason = 'RECIPIENT_UNAVAILABLE';
        }
        if (reason) {
          await manager.query(
            `UPDATE mail_notification_deliveries SET status='skipped',error_code=$2 WHERE id=$1`,
            [job.id, reason],
          );
          return;
        }
        if (policy.resume) {
          await manager.query(
            `UPDATE mail_notification_deliveries SET status='pending',digest_at=$2,attempts=attempts-1,claimed_at=NULL WHERE id=$1`,
            [job.id, policy.resume],
          );
          return;
        }
        const [first] = await manager.query<
          { subject: string; occurred_at: Date }[]
        >('SELECT subject,occurred_at FROM mail_messages WHERE id=$1', [
          job.first_message_id,
        ]);
        const text = formatMailUnassignedReminder(
          thread.name,
          first.subject,
          first.occurred_at,
          this.feishu.mailThreadUrl(
            thread.mailbox,
            job.thread_id,
            job.first_message_id,
          ),
        );
        try {
          const result = await this.feishu.sendText(job.open_id, text, job.id);
          await manager.query(
            `UPDATE mail_notification_deliveries SET status='sent',sent_at=now(),message_id=$2,error_code=NULL WHERE id=$1`,
            [job.id, result.messageId],
          );
        } catch (error) {
          const { status, errorCode, retryAfter } = directDeliveryFailure(
            error,
            job.attempts,
          );
          await manager.query(
            `UPDATE mail_notification_deliveries SET status=$2,error_code=$3,next_attempt_at=now()+($4::int*interval '1 second') WHERE id=$1`,
            [job.id, status, errorCode, retryAfter],
          );
        }
      });
    }
  }
}
