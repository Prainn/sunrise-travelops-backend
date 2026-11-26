import {
  NotificationType,
  notificationPolicy,
} from '../notifications/notification-settings';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { effectivePermissions } from '../auth/identity-permissions';
import { FeishuService } from '../feishu/feishu.service';
import {
  formatLedgerReminder,
  LedgerReminderData,
} from '../feishu/ledger-reminder';

export interface LedgerReminderRow extends LedgerReminderData {
  id: string;
  version: number;
  operatorId: string;
  reviewedAt: Date | null;
  operated: boolean;
  proposalSent: boolean;
  orderStatus: string;
}

export function reminderKind(
  row?: Pick<
    LedgerReminderRow,
    'operated' | 'loss' | 'reviewedAt' | 'proposalSent' | 'orderStatus'
  >,
): 'review' | 'operate' | null {
  if (!row || row.operated) return null;
  if (row.loss && !row.reviewedAt) return 'review';
  return row.proposalSent && row.orderStatus === 'converted' ? 'operate' : null;
}

export function eligibleLedgerRecipient(
  unit: LedgerReminderRow['businessUnit'],
  kind: 'review' | 'operate',
  roles: string[],
) {
  return (
    (kind !== 'review' || roles.includes('BUSINESS_MANAGER')) &&
    effectivePermissions(unit, roles).includes(`ledger:direct:${kind}`)
  );
}

@Injectable()
export class LedgerNotificationsService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LedgerNotificationsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(
    private readonly db: DataSource,
    private readonly feishu: FeishuService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      if (!this.running && this.feishu.configured) {
        this.running = this.drain()
          .catch(() => {
            this.logger.error('Feishu notification worker failed');
          })
          .finally(() => {
            this.running = undefined;
          });
      }
    }, 5000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }

  private async recipients(
    manager: EntityManager,
    row: LedgerReminderRow,
    kind: 'review' | 'operate',
  ) {
    const users = await manager.query<
      { id: string; openId: string; roles: string[] }[]
    >(
      `SELECT u.id,u.feishu_open_id AS "openId",array_agg(DISTINCT r.code) AS roles
       FROM users u JOIN user_identities i ON i.user_id=u.id
       JOIN identity_roles ir ON ir.identity_id=i.id JOIN roles r ON r.id=ir.role_id AND r.is_enabled
       WHERE i.scope=$1 AND u.status='enabled' AND u.deleted_at IS NULL
       AND NOT u.is_superuser AND u.feishu_open_id<>''
       AND ($2='review' OR u.id=$3)
       GROUP BY u.id,i.id`,
      [row.businessUnit, kind, row.operatorId],
    );
    return users.filter((user) =>
      eligibleLedgerRecipient(row.businessUnit, kind, user.roles),
    );
  }

  async enqueue(
    manager: EntityManager,
    row: LedgerReminderRow,
    previous?: LedgerReminderRow,
  ) {
    const kind = reminderKind(row);
    if (
      kind === reminderKind(previous) &&
      (kind !== 'operate' || previous?.operatorId === row.operatorId)
    )
      return;
    const policy =
      kind && this.feishu.configured
        ? await notificationPolicy(
            manager,
            `${row.businessUnit}_ledger_${kind}`,
          )
        : null;
    await manager.query(
      `UPDATE feishu_ledger_notifications SET status='skipped' WHERE ledger_id=$1 AND status='pending'`,
      [row.id],
    );
    if (!kind || !policy?.enabled) return;
    for (const recipient of await this.recipients(manager, row, kind)) {
      await manager.query(
        `INSERT INTO feishu_ledger_notifications(ledger_id,ledger_version,kind,recipient_id,digest_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [row.id, row.version, kind, recipient.id, policy.resume],
      );
    }
  }

  async drain() {
    if (!this.feishu.configured) return;
    // Each claim stays locked through delivery, so multiple API processes cannot send it concurrently.
    for (let count = 0; count < 10; count++) {
      const processed = await this.db.transaction(async (manager) => {
        const [candidate] = await manager.query<
          { id: string; type: NotificationType; created_at: Date }[]
        >(
          `SELECT j.id,l.business_unit||'_ledger_'||j.kind AS type,j.created_at
           FROM feishu_ledger_notifications j JOIN direct_ledgers l ON l.id=j.ledger_id
           WHERE j.status='pending' AND j.digest_at IS NULL AND j.next_attempt_at<=now()
           ORDER BY j.next_attempt_at,j.id LIMIT 1`,
        );
        if (!candidate) return false;
        const policy = await notificationPolicy(
          manager,
          candidate.type,
          candidate.created_at,
        );
        const [job] = await manager.query<
          {
            id: string;
            ledger_id: string;
            recipient_id: string;
            kind: 'review' | 'operate';
            attempts: number;
            created_at: Date;
          }[]
        >(
          `SELECT * FROM feishu_ledger_notifications WHERE id=$1 AND status='pending' AND digest_at IS NULL AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED`,
          [candidate.id],
        );
        if (!job) return true;
        const [row] = await manager.query<LedgerReminderRow[]>(
          `SELECT id,version,business_unit AS "businessUnit",order_no AS "orderNo",creator_name AS "creatorName",
           source,receiving_account_name AS "receivingAccountName",loss_note AS "lossNote",
           operator_id AS "operatorId",loss,reviewed_at AS "reviewedAt",operated,proposal_sent AS "proposalSent",order_status AS "orderStatus"
           FROM direct_ledgers WHERE id=$1`,
          [job.ledger_id],
        );
        const recipient =
          row && reminderKind(row) === job.kind && policy?.enabled
            ? (await this.recipients(manager, row, job.kind)).find(
                (user) => user.id === job.recipient_id,
              )
            : undefined;
        if (!recipient) {
          await manager.query(
            `UPDATE feishu_ledger_notifications SET status='skipped' WHERE id=$1`,
            [job.id],
          );
          return true;
        }
        if (policy.resume) {
          await manager.query(
            'UPDATE feishu_ledger_notifications SET digest_at=$2 WHERE id=$1',
            [job.id, policy.resume],
          );
          return true;
        }
        const attempt = job.attempts + 1;
        try {
          const { messageId } = await this.feishu.sendText(
            recipient.openId,
            formatLedgerReminder(
              job.kind,
              row,
              this.feishu.ledgerUrl(
                row.businessUnit,
                row.orderNo,
                row.id,
                job.kind,
              ),
            ),
            job.id,
          );
          await manager.query(
            `UPDATE feishu_ledger_notifications SET status='sent',attempts=$2,message_id=$3 WHERE id=$1`,
            [job.id, attempt, messageId],
          );
        } catch {
          await manager.query(
            `UPDATE feishu_ledger_notifications SET status=$2,attempts=$3,next_attempt_at=now()+($4 * interval '1 second') WHERE id=$1`,
            [
              job.id,
              attempt >= 4 ? 'failed' : 'pending',
              attempt,
              [30, 120, 480, 0][attempt - 1],
            ],
          );
          this.logger.warn(
            `Feishu notification ${job.id} attempt ${attempt} failed`,
          );
        }
        return true;
      });
      if (!processed) break;
    }
  }
}
