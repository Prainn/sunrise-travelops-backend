import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import { MediaConfig } from '../media/media.config';
import { MediaStorage } from '../media/media.storage';
import { AliMailError, AliMailProvider, RemoteMail } from './alimail.provider';
import {
  insertMailQuotes,
  splitMailBody,
} from '../migrations/support/mail-quoted-body-v1';
import { MAILBOX } from './mail.types';

export function mailObjectKey(environment: string, thread: string, id: string) {
  return `private/${environment}/email/${thread}/${id}.bin`;
}
export function safeMailFileName(name: string) {
  const base = (name.split(/[\\/]/).at(-1) ?? '')
    .replace(/[\p{C}]/gu, '')
    .trim();
  return Array.from(base).slice(0, 120).join('') || 'attachment';
}
@Injectable()
export class MailSync implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailSync.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  constructor(
    private readonly db: DataSource,
    private readonly provider: AliMailProvider,
    private readonly storage: MediaStorage,
    private readonly media: MediaConfig,
  ) {}
  onModuleInit() {
    if (!this.provider.enabled) return;
    const tick = () => {
      if (this.running) return;
      this.running = this.poll()
        .catch(() => this.logger.warn('阿里邮箱同步失败，下一轮从原进度继续'))
        .finally(() => {
          this.running = undefined;
        });
    };
    this.timer = setInterval(tick, 30000);
    this.timer.unref();
    tick();
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }
  async poll() {
    const runner = this.db.createQueryRunner();
    await runner.connect();
    try {
      const [{ locked }] = await runner.manager.query<{ locked: boolean }[]>(
        "SELECT pg_try_advisory_lock(hashtext('alimail-biz-sync')) AS locked",
      );
      if (!locked) return;
      try {
        // Preparation can never have sent mail. A stale send must be reconciled with Sent Items.
        await runner.query(`UPDATE mail_messages SET state=CASE WHEN state='preparing' THEN 'failed' ELSE 'unknown' END,version=version+1,updated_at=now()
          WHERE state IN ('preparing','sending') AND updated_at < now()-interval '15 minutes'`);
        for (const folder of ['1', '2']) {
          try {
            await this.syncPage(folder);
          } catch {
            this.logger.warn('阿里邮箱文件夹同步未完成 ' + folder);
          }
        }
        await this.archiveFiles();
      } finally {
        await runner.query(
          "SELECT pg_advisory_unlock(hashtext('alimail-biz-sync'))",
        );
      }
    } finally {
      await runner.release();
    }
  }
  private async syncPage(folder: string) {
    const initial = this.provider.startAt ?? new Date().toISOString();
    await this.db.query(
      'INSERT INTO mail_sync(mailbox,folder,start_at,floor_at) VALUES($1,$2,$3,$3) ON CONFLICT DO NOTHING',
      [MAILBOX, folder, initial],
    );
    const [sync] = await this.db.query<
      { start_at: Date; end_at: Date; cursor: string | null }[]
    >(
      'WITH sync_window AS (UPDATE mail_sync SET end_at=coalesce(end_at,now()) WHERE mailbox=$1 AND folder=$2 RETURNING *) SELECT * FROM sync_window',
      [MAILBOX, folder],
    );
    if (sync.end_at < sync.start_at) {
      await this.db.query(
        'UPDATE mail_sync SET end_at=NULL WHERE mailbox=$1 AND folder=$2',
        [MAILBOX, folder],
      );
      return;
    }
    const page = await this.provider.list(
      folder,
      sync.start_at,
      sync.end_at,
      sync.cursor,
    );
    for (const row of page.messages ?? []) {
      const [known] = await this.db.query<{ id: string }[]>(
        'SELECT id FROM mail_messages WHERE provider_id=$1',
        [row.id],
      );
      if (known) continue;
      try {
        const remote = await this.provider.message(row.id, folder === '2');
        await this.db.transaction((m) =>
          this.ingest(m, remote, folder === '2'),
        );
      } catch (error) {
        // A message may move or be deleted between the folder listing and the detail read.
        if (!(error instanceof AliMailError && error.status === 404))
          throw error;
      }
    }
    if (page.hasMore) {
      if (!page.nextCursor || page.nextCursor === sync.cursor)
        throw new Error('ALI_MAIL_INVALID_CURSOR');
      await this.db.query(
        'UPDATE mail_sync SET cursor=$3 WHERE mailbox=$1 AND folder=$2',
        [MAILBOX, folder, page.nextCursor],
      );
    } else
      await this.db.query(
        "UPDATE mail_sync SET start_at=greatest(floor_at,end_at-interval '60 seconds'),end_at=NULL,cursor=NULL WHERE mailbox=$1 AND folder=$2",
        [MAILBOX, folder],
      );
  }
  private async bind(m: EntityManager, id: string, keys: string[]) {
    await m.query(
      'INSERT INTO mail_thread_keys(mailbox,internet_id,thread_id) SELECT $1,k,$2 FROM unnest($3::text[]) k ON CONFLICT DO NOTHING',
      [MAILBOX, id, keys],
    );
  }
  async ingest(m: EntityManager, mail: RemoteMail, inbound: boolean) {
    const keys = [
      ...new Set([...mail.refs, ...(mail.internetId ? [mail.internetId] : [])]),
    ];
    if (!inbound && mail.sender.email.toLowerCase() === MAILBOX) {
      const [local] = await m.query<{ id: string; threadId: string }[]>(
        `SELECT d.id,d.thread_id AS "threadId" FROM mail_messages d JOIN mail_messages original ON original.id=d.original_id
         JOIN mail_threads t ON t.id=d.thread_id
         WHERE t.mailbox=$5 AND d.actor_id IS NOT NULL AND d.state IN ('sending','unknown','sent') AND original.internet_id=ANY($3::text[])
         AND (d.id::text=$1 OR d.internet_id=$2 OR d.remote_draft_id=$4) FOR UPDATE OF d`,
        [
          mail.marker ?? '',
          mail.internetId,
          mail.refs,
          mail.providerId,
          MAILBOX,
        ],
      );
      if (local) {
        await m.query(
          `UPDATE mail_messages SET state='sent',provider_id=$2,internet_id=$3,occurred_at=$4,updated_at=now() WHERE id=$1`,
          [local.id, mail.providerId, mail.internetId, mail.occurredAt],
        );
        await this.bind(m, local.threadId, keys);
        await m.query(
          'UPDATE mail_threads SET last_at=greatest(last_at,$2) WHERE id=$1',
          [local.threadId, mail.occurredAt],
        );
        return;
      }
    }
    const [known] = await m.query<{ id: string }[]>(
      `SELECT thread_id AS id FROM mail_thread_keys WHERE mailbox=$1 AND internet_id=ANY($2::text[]) ORDER BY array_position($2::text[],internet_id) DESC LIMIT 1`,
      [MAILBOX, keys],
    );
    if (!inbound && !known && !mail.refs.length) return;
    const customer = inbound
      ? mail.sender
      : (mail.recipients[0] ?? mail.sender);
    let threadId = known?.id;
    if (!threadId) {
      const [thread] = await m.query<{ id: string }[]>(
        'INSERT INTO mail_threads(mailbox,subject,customer_email,customer_name,last_at,has_inbound) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
        [
          MAILBOX,
          mail.subject,
          customer.email.toLowerCase(),
          customer.name || '',
          mail.occurredAt,
          inbound,
        ],
      );
      threadId = thread.id;
    }
    if (inbound && known) {
      await m.query(
        'UPDATE mail_threads SET has_inbound=true,subject=$2,customer_email=$3,customer_name=$4 WHERE id=$1 AND NOT has_inbound',
        [
          threadId,
          mail.subject,
          customer.email.toLowerCase(),
          customer.name || '',
        ],
      );
    }
    const { authoredBody, quotes } = splitMailBody(mail.body);
    const [msg] = await m.query<{ id: string }[]>(
      `INSERT INTO mail_messages(thread_id,provider_id,internet_id,refs,direction,state,subject,sender,recipients,cc,reply_to,body,occurred_at,is_read,authored_body)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING RETURNING id`,
      [
        threadId,
        mail.providerId,
        mail.internetId,
        mail.refs,
        inbound ? 'inbound' : 'outbound',
        inbound ? 'received' : 'sent',
        mail.subject,
        JSON.stringify(mail.sender),
        JSON.stringify(mail.recipients),
        JSON.stringify(mail.cc),
        JSON.stringify(mail.replyTo),
        mail.body,
        mail.occurredAt,
        !inbound || mail.isRead,
        authoredBody,
      ],
    );
    if (!msg) return;
    await insertMailQuotes(m, msg.id, quotes);
    await this.bind(m, threadId, keys);
    await m.query(
      'UPDATE mail_threads SET last_at=greatest(last_at,$2) WHERE id=$1',
      [threadId, mail.occurredAt],
    );
    for (const file of mail.attachments)
      await m.query(
        'INSERT INTO mail_attachments(message_id,provider_id,file_name,size_bytes) VALUES($1,$2,$3,$4)',
        [msg.id, file.id, safeMailFileName(file.name), file.size],
      );
  }
  private async archiveFiles() {
    const files = await this.db.query<
      {
        id: string;
        thread_id: string;
        provider_id: string;
        message: string;
        mailbox: string;
        size_bytes: string;
        object_key: string | null;
        removed_at: Date | null;
      }[]
    >(
      `SELECT a.*,m.provider_id AS message,m.thread_id,t.mailbox FROM mail_attachments a LEFT JOIN mail_messages m ON m.id=a.message_id LEFT JOIN mail_threads t ON t.id=m.thread_id
       WHERE (a.removed_at IS NOT NULL OR (a.provider_id IS NOT NULL AND a.object_key IS NULL)) AND a.retry_at<=now()
       ORDER BY a.retry_at,a.id LIMIT 12`,
    );
    for (const file of files) {
      try {
        if (file.removed_at) {
          if (file.object_key) await this.storage.remove([file.object_key]);
          await this.db.query(
            'DELETE FROM mail_attachments WHERE id=$1 AND removed_at IS NOT NULL',
            [file.id],
          );
          continue;
        }
        const response = await this.provider.download(
          file.mailbox,
          file.message,
          file.provider_id,
        );
        if (!response.body) throw new Error('ALI_MAIL_EMPTY_STREAM');
        const contentLength = response.headers.get('content-length');
        if (
          contentLength !== null &&
          !response.headers.get('content-encoding') &&
          Number(contentLength) !== Number(file.size_bytes)
        )
          throw new Error('ALI_MAIL_SIZE');
        const key = mailObjectKey(
          this.media.environment,
          file.thread_id,
          file.id,
        );
        await this.storage.putMail(
          key,
          Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
          Number(file.size_bytes),
        );
        await this.db.query(
          'UPDATE mail_attachments SET object_key=$2 WHERE id=$1',
          [file.id, key],
        );
      } catch {
        await this.db.query(
          "UPDATE mail_attachments SET retry_at=now()+interval '2 minutes' WHERE id=$1",
          [file.id],
        );
        this.logger.warn('邮件附件 OSS 归档待重试 ' + file.id);
      }
    }
  }
}
