import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { MediaConfig } from '../media/media.config';
import { MediaStorage } from '../media/media.storage';
import { validateDocument } from '../media/media.document-format';
import { prepareImage } from '../media/media.images';
import { AliMailError, AliMailProvider } from './alimail.provider';
import { MailVersionDto, SaveMailDraftDto } from './mail.dto';
import { MailService, mailVersion, messageColumns } from './mail.service';
import { MailMessage, mailFail, mailSignature } from './mail.types';
import { mailObjectKey, safeMailFileName } from './mail.sync';

@Injectable()
export class MailReplies {
  constructor(
    private readonly db: DataSource,
    private readonly mail: MailService,
    private readonly provider: AliMailProvider,
    private readonly storage: MediaStorage,
    private readonly media: MediaConfig,
  ) {}
  private async reply(
    m: EntityManager,
    thread: string,
    id: string,
    user: AuthenticatedUser,
    lock = false,
  ) {
    const t = await this.mail.thread(thread, user, m, lock);
    this.mail.writable(t, user, 'mail:message:send');
    const [row] = await m.query<MailMessage[]>(
      `SELECT ${messageColumns} FROM mail_messages m WHERE m.id=$1 AND m.thread_id=$2 AND m.actor_id=$3${lock ? ' FOR UPDATE OF m' : ''}`,
      [id, thread, user.id],
    );
    if (!row) mailFail('NOT_FOUND', '回复草稿不存在或不可访问', 404);
    return row;
  }
  private editable(row: MailMessage, version: number) {
    if (row.state !== 'draft' && row.state !== 'failed')
      mailFail('CONFLICT', '当前回复不能编辑或重复发送', 409);
    mailVersion(row.version, version);
  }
  async open(thread: string, source: string, user: AuthenticatedUser) {
    return this.db.transaction(async (m) => {
      const t = await this.mail.thread(thread, user, m, true);
      this.mail.writable(t, user, 'mail:message:send');
      const original = await this.mail.original(m, thread, source);
      if (!original.internetId)
        mailFail('CONFLICT', '原信缺少邮件标识，无法关联回复', 409);
      const [existing] = await m.query<{ id: string }[]>(
        "SELECT id FROM mail_messages WHERE original_id=$1 AND actor_id=$2 AND state<>'sent'",
        [source, user.id],
      );
      if (existing) return this.reply(m, thread, existing.id, user);
      const to = original.replyTo.length ? original.replyTo : [original.sender];
      const [draft] = await m.query<{ id: string }[]>(
        `INSERT INTO mail_messages(thread_id,original_id,direction,state,subject,sender,recipients,actor_id,is_read)
       VALUES($1,$2,'outbound','draft',$3,$4,$5,$6,true) RETURNING id`,
        [
          thread,
          source,
          /^re\s*:/i.test(original.subject)
            ? original.subject
            : 'Re: ' + original.subject,
          JSON.stringify({ email: t.mailbox }),
          JSON.stringify(to),
          user.id,
        ],
      );
      return this.reply(m, thread, draft.id, user);
    });
  }
  async save(
    thread: string,
    id: string,
    input: SaveMailDraftDto,
    user: AuthenticatedUser,
  ) {
    return this.db.transaction(async (m) => {
      const draft = await this.reply(m, thread, id, user, true);
      this.editable(draft, input.version);
      const addresses = (items: string[]) =>
        JSON.stringify(items.map((email) => ({ email })));
      await m.query(
        `UPDATE mail_messages SET state='draft',body=$2,subject=$3,recipients=$4,cc=$5,version=version+1,updated_at=now() WHERE id=$1`,
        [
          id,
          input.body,
          input.subject,
          addresses(input.to),
          addresses(input.cc),
        ],
      );
      return this.reply(m, thread, id, user);
    });
  }
  async attach(
    thread: string,
    id: string,
    file: Express.Multer.File | undefined,
    user: AuthenticatedUser,
  ) {
    if (!file?.buffer.length) mailFail('VALIDATION_ERROR', '请选择附件', 400);
    await this.reply(this.db.manager, thread, id, user);
    let name: string;
    if (/\.(pdf|docx?)$/i.test(file.originalname))
      name = (await validateDocument(file.buffer, file.originalname)).fileName;
    else {
      const image = await prepareImage(file.buffer, 'image').catch(() =>
        mailFail('VALIDATION_ERROR', '请选择有效的图片、PDF 或 Word', 400),
      );
      let decoded = file.originalname;
      if (Array.from(decoded).every((c) => c.charCodeAt(0) <= 255)) {
        try {
          decoded = new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.from(decoded, 'latin1'),
          );
        } catch {
          /* Already Latin-1. */
        }
      }
      name = safeMailFileName(
        decoded.replace(/\.[^./\\]+$/, '') + '.' + image.ext,
      );
    }
    const fileId = randomUUID(),
      key = mailObjectKey(this.media.environment, thread, fileId);
    try {
      return await this.db.transaction(async (m) => {
        const draft = await this.reply(m, thread, id, user, true);
        this.editable(draft, draft.version);
        await this.storage.putMail(key, file.buffer, file.buffer.length);
        await m.query(
          'INSERT INTO mail_attachments(id,message_id,file_name,size_bytes,object_key) VALUES($1,$2,$3,$4,$5)',
          [fileId, id, name, file.buffer.length, key],
        );
        await m.query(
          'UPDATE mail_messages SET version=version+1,updated_at=now() WHERE id=$1',
          [id],
        );
        return this.reply(m, thread, id, user);
      });
    } catch (error) {
      // A lost commit response may still have attached the file.
      const [saved] = await this.db.query<{ id: string }[]>(
        'SELECT id FROM mail_attachments WHERE id=$1',
        [fileId],
      );
      if (!saved) await this.storage.remove([key]).catch(() => undefined);
      throw error;
    }
  }
  async remove(
    thread: string,
    id: string,
    file: string,
    user: AuthenticatedUser,
  ) {
    return this.db.transaction(async (m) => {
      const draft = await this.reply(m, thread, id, user, true);
      this.editable(draft, draft.version);
      await m.query(
        'UPDATE mail_attachments SET removed_at=now(),retry_at=now() WHERE id=$1 AND message_id=$2 AND removed_at IS NULL',
        [file, id],
      );
      await m.query(
        'UPDATE mail_messages SET version=version+1,updated_at=now() WHERE id=$1',
        [id],
      );
      return this.reply(m, thread, id, user);
    });
  }
  async send(
    thread: string,
    id: string,
    input: MailVersionDto,
    user: AuthenticatedUser,
  ) {
    const job = await this.db.transaction(async (m) => {
      const draft = await this.reply(m, thread, id, user, true);
      if (['preparing', 'sending', 'sent', 'unknown'].includes(draft.state))
        return null;
      this.editable(draft, input.version);
      if (!this.provider.enabled) mailFail('CONFLICT', '邮箱接入尚未启用', 409);
      if (
        !draft.recipients.length ||
        (!draft.body.trim() && !draft.attachments.length)
      )
        mailFail('VALIDATION_ERROR', '请补全收件人及回复内容', 400);
      const original = await this.mail.original(m, thread, draft.originalId!);
      if (!original.internetId) mailFail('CONFLICT', '无法关联原信', 409);
      const [{ name, mailbox }] = await m.query<
        { name: string; mailbox: string }[]
      >(
        'SELECT trim(u.english_name) AS name,t.mailbox FROM users u JOIN mail_threads t ON t.id=$2 WHERE u.id=$1',
        [user.id, thread],
      );
      if (!name) mailFail('VALIDATION_ERROR', '请先维护回复计调的英文名', 400);
      const signature = mailSignature(name);
      await m.query(
        `UPDATE mail_messages SET state='preparing',version=version+1,signature=$2,internet_id=$3,remote_draft_id=NULL,updated_at=now() WHERE id=$1`,
        [id, signature, id + '@lynxtour.cn'],
      );
      return {
        mailbox,
        draft,
        name,
        parent: original.internetId,
        references: original.refs,
      };
    });
    if (!job) return this.reply(this.db.manager, thread, id, user);
    const revision = job.draft.version + 1;
    let dispatch = false;
    try {
      const remote = await this.provider.createReply({
        mailbox: job.mailbox,
        id,
        name: job.name,
        parent: job.parent,
        references: job.references,
        subject: job.draft.subject,
        to: job.draft.recipients,
        cc: job.draft.cc,
        body: job.draft.body,
      });
      for (const file of job.draft.attachments) {
        const [row] = await this.db.query<{ key: string }[]>(
          'SELECT object_key AS key FROM mail_attachments WHERE id=$1 AND message_id=$2 AND removed_at IS NULL',
          [file.id, id],
        );
        const { url } = await this.storage.signDocument(
          row.key,
          'send',
          file.fileName,
        );
        const response = await fetch(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(60000),
        });
        if (!response.ok) throw new Error('MAIL_OSS_READ_FAILED');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== file.sizeBytes) throw new Error('MAIL_OSS_SIZE');
        await this.provider.upload(
          job.mailbox,
          remote.id,
          file.fileName,
          bytes,
        );
      }
      const changed = await this.db.query<{ id: string }[]>(
        `WITH changed AS (UPDATE mail_messages SET state='sending',remote_draft_id=$2,internet_id=$4,updated_at=now()
           WHERE id=$1 AND state='preparing' AND version=$3 RETURNING id,thread_id),
         bound AS (INSERT INTO mail_thread_keys(mailbox,internet_id,thread_id)
           SELECT $5,k,thread_id FROM changed CROSS JOIN unnest(ARRAY[$4::text,$6::text]) k ON CONFLICT DO NOTHING)
         SELECT id FROM changed`,
        [
          id,
          remote.id,
          revision,
          remote.internetId,
          job.mailbox,
          id + '@lynxtour.cn',
        ],
      );
      if (!changed.length) mailFail('CONFLICT', '回复状态已更新', 409);
      dispatch = true;
      await this.provider.send(job.mailbox, remote.id);
      await this.db.transaction(async (m) => {
        await m.query(
          "UPDATE mail_messages SET state='sent',occurred_at=now(),updated_at=now(),version=version+1 WHERE id=$1 AND state='sending'",
          [id],
        );
        await m.query(
          'UPDATE mail_threads SET last_at=greatest(last_at,now()) WHERE id=$1',
          [thread],
        );
      });
    } catch (error) {
      const rejected =
        error instanceof AliMailError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 409].includes(error.status);
      const state = dispatch && !rejected ? 'unknown' : 'failed';
      await this.db.query(
        "UPDATE mail_messages SET state=$2,version=version+1,updated_at=now() WHERE id=$1 AND version=$3 AND state IN ('preparing','sending')",
        [id, state, revision],
      );
    }
    return this.reply(this.db.manager, thread, id, user);
  }
}
