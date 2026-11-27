import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { isFullAdministrator } from '../auth/account-access';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  integrationEnvironment,
  UpdateIntegrationRuntimeDto,
} from '../common/integration-runtime';
import { AliMailProvider } from './alimail.provider';
import { MAILBOX, mailFail, requireMail } from './mail.types';

export const INBOX_FOLDER = '2';
export const SENT_FOLDER = '1';
const SYNC_STALE_MS = 90_000;

interface RuntimeSettings {
  inbound_enabled: boolean;
  outbound_enabled: boolean;
  version: number;
}

interface SyncActivity {
  lastStartedAt: Date | null;
  lastCompletedAt: Date | null;
  lastErrorAt: Date | null;
}

function syncStatus(
  activity: SyncActivity | undefined,
  available: boolean,
  paused: boolean,
  now: number,
) {
  const times = activity ?? {
    lastStartedAt: null,
    lastCompletedAt: null,
    lastErrorAt: null,
  };
  const completedAt = times.lastCompletedAt?.getTime();
  const failedAt = times.lastErrorAt?.getTime();
  let state:
    'disabled' | 'paused' | 'starting' | 'running' | 'stalled' | 'error';
  if (!available) state = 'disabled';
  else if (paused) state = 'paused';
  else if (
    failedAt !== undefined &&
    (completedAt === undefined || failedAt > completedAt)
  )
    state = 'error';
  else if (completedAt !== undefined)
    state = now - completedAt > SYNC_STALE_MS ? 'stalled' : 'running';
  else state = 'starting';
  return { state, ...times };
}

@Injectable()
export class MailRuntime {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly provider: AliMailProvider,
  ) {}

  private present(row: RuntimeSettings) {
    const available = this.provider.enabled;
    return {
      environment: integrationEnvironment(
        this.config.get<string>('DATABASE_NAME'),
      ),
      version: row.version,
      inboundAvailable: available,
      outboundAvailable: available,
      inboundEnabled: available && row.inbound_enabled,
      outboundEnabled: available && row.outbound_enabled,
    };
  }

  async state(manager = this.db.manager, lock = false) {
    const [row] = await manager.query<RuntimeSettings[]>(
      'SELECT inbound_enabled,outbound_enabled,version FROM mail_runtime_settings WHERE id=1' +
        (lock ? ' FOR SHARE' : ''),
    );
    if (!row) throw new Error('MAIL_RUNTIME_NOT_INITIALIZED');
    return this.present(row);
  }

  private requireAdministrator(user: AuthenticatedUser) {
    requireMail(user, 'whatsapp:integration:manage');
    if (!isFullAdministrator(user))
      mailFail('AUTH_FORBIDDEN', '仅管理员可查看接入状态', 403);
  }

  async integration(user: AuthenticatedUser) {
    this.requireAdministrator(user);
    const [runtime, rows] = await Promise.all([
      this.state(),
      this.db.query<(SyncActivity & { mailbox: string; folder: string })[]>(
        `
        SELECT mailbox,folder,last_started_at AS "lastStartedAt",last_completed_at AS "lastCompletedAt",last_error_at AS "lastErrorAt"
        FROM mail_sync WHERE folder IN ($1,$2) ORDER BY mailbox`,
        [INBOX_FOLDER, SENT_FOLDER],
      ),
    ]);
    const now = Date.now();
    return {
      runtime,
      staleAfterSeconds: SYNC_STALE_MS / 1000,
      mailboxes: [...new Set([MAILBOX, ...rows.map((row) => row.mailbox)])].map(
        (mailbox) => {
          const inbox = rows.find(
            (row) => row.mailbox === mailbox && row.folder === INBOX_FOLDER,
          );
          const sent = rows.find(
            (row) => row.mailbox === mailbox && row.folder === SENT_FOLDER,
          );
          return {
            mailbox,
            inbox: syncStatus(
              inbox,
              runtime.inboundAvailable,
              !runtime.inboundEnabled,
              now,
            ),
            sent: syncStatus(sent, runtime.inboundAvailable, false, now),
          };
        },
      ),
    };
  }

  async update(input: UpdateIntegrationRuntimeDto, user: AuthenticatedUser) {
    this.requireAdministrator(user);
    if (
      input.inboundEnabled === undefined &&
      input.outboundEnabled === undefined
    )
      mailFail('VALIDATION_ERROR', '请选择要修改的开关', 400);
    if (
      !this.provider.enabled &&
      (input.inboundEnabled === true || input.outboundEnabled === true)
    )
      mailFail('CONFLICT', '当前环境的基础接入配置不允许启用该开关', 409);
    return this.db.transaction(async (manager) => {
      const [[row]] = await manager.query<[RuntimeSettings[], number]>(
        `
        UPDATE mail_runtime_settings SET inbound_enabled=coalesce($2,inbound_enabled),
          outbound_enabled=coalesce($3,outbound_enabled),version=version+1 WHERE id=1 AND version=$1
        RETURNING inbound_enabled,outbound_enabled,version`,
        [
          input.version,
          input.inboundEnabled ?? null,
          input.outboundEnabled ?? null,
        ],
      );
      if (!row) mailFail('CONFLICT', '开关状态已变化，请刷新后重试', 409);
      // Keep a starting point even if the first poll has not yet registered the inbox.
      if (input.inboundEnabled === false && this.provider.enabled) {
        await manager.query(
          `INSERT INTO mail_sync(mailbox,folder,start_at,floor_at)
          VALUES($1,$2,coalesce($3::timestamptz,now()),coalesce($3::timestamptz,now())) ON CONFLICT DO NOTHING`,
          [MAILBOX, INBOX_FOLDER, this.provider.startAt ?? null],
        );
      }
      return this.present(row);
    });
  }
}
