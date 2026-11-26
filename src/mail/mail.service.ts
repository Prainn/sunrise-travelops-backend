import { assertMailAssignable, recordMailAssignment } from './mail.assignment';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { WebsiteService } from '../website/website.service';
import { AssignChatDto, CreateChatInquiryDto } from '../whatsapp/whatsapp.dto';
import { MediaStorage } from '../media/media.storage';
import { MailListQuery } from './mail.dto';
import {
  MailMessage,
  MailThread,
  mailManager,
  requireMail,
  mailFail,
  mailSignature,
} from './mail.types';

const columns = `t.id,t.mailbox,t.subject,t.customer_email AS "customerEmail",t.customer_name AS "customerName",t.last_at AS "lastAt",
 t.owner_id AS "ownerId",u.nickname AS "ownerName",t.inquiry_id AS "inquiryId",t.source_message_id AS "sourceMessageId",
 t.assignment_locked AS "assignmentLocked",t.version,(SELECT count(*)::int FROM mail_messages m WHERE m.thread_id=t.id AND m.direction='inbound' AND NOT m.is_read) AS "unreadCount"`;
const threadFrom = 'FROM mail_threads t LEFT JOIN users u ON u.id=t.owner_id';
export const messageColumns = `m.id,m.thread_id AS "threadId",m.direction,m.state,m.subject,m.sender,m.recipients,m.cc,m.reply_to AS "replyTo",m.body,m.occurred_at AS "occurredAt",
 m.actor_id AS "actorId",m.original_id AS "originalId",m.signature,m.version,m.is_read AS "isRead",m.internet_id AS "internetId",m.refs,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'fileName',a.file_name,'sizeBytes',a.size_bytes,'available',a.object_key IS NOT NULL) ORDER BY a.file_name,a.id)
 FROM mail_attachments a WHERE a.message_id=m.id AND a.removed_at IS NULL),'[]') AS attachments`;

export function mailVersion(actual: number, expected: number) {
  if (actual !== expected)
    mailFail('CONFLICT', '资料已更新，请刷新后重试', 409);
}
@Injectable()
export class MailService {
  constructor(
    private readonly db: DataSource,
    private readonly website: WebsiteService,
    private readonly storage: MediaStorage,
  ) {}
  private scope(user: AuthenticatedUser, params: unknown[]) {
    requireMail(user, 'mail:thread:list');
    if (mailManager(user)) return 't.has_inbound';
    const owner = '$' + params.push(user.id);
    // Explicit customer history follows the WhatsApp rule only once the older inquiry has formed a tour.
    return `t.has_inbound AND (t.owner_id=${owner} OR (EXISTS(SELECT 1 FROM tours tour WHERE tour.source_module='website' AND tour.inquiry_id=t.inquiry_id)
       AND EXISTS(SELECT 1 FROM mail_threads current WHERE current.mailbox=t.mailbox AND current.customer_email=t.customer_email AND current.owner_id=${owner} AND current.id<>t.id
       AND (SELECT min(occurred_at) FROM mail_messages WHERE thread_id=current.id AND direction='inbound') > (SELECT min(occurred_at) FROM mail_messages WHERE thread_id=t.id AND direction='inbound'))))`;
  }
  async thread(
    id: string,
    user: AuthenticatedUser,
    m = this.db.manager,
    lock = false,
  ) {
    const params: unknown[] = [id],
      scope = this.scope(user, params);
    const [row] = await m.query<MailThread[]>(
      `SELECT ${columns} ${threadFrom} WHERE t.id=$1 AND ${scope}${lock ? ' FOR UPDATE OF t' : ''}`,
      params,
    );
    if (!row) mailFail('NOT_FOUND', '邮件会话不存在或不可访问', 404);
    return row;
  }
  writable(t: MailThread, user: AuthenticatedUser, permission: string) {
    requireMail(user, permission);
    if (t.ownerId !== user.id && !mailManager(user))
      mailFail('AUTH_FORBIDDEN', '历史邮件会话只读', 403);
  }
  async unread(user: AuthenticatedUser) {
    requireMail(user, 'mail:thread:list');
    const manager = mailManager(user);
    const [result] = await this.db.query<{ unreadCount: number }[]>(
      `SELECT count(*)::int AS "unreadCount" FROM mail_messages m
       JOIN mail_threads t ON t.id=m.thread_id
       WHERE m.direction='inbound' AND NOT m.is_read AND t.has_inbound${manager ? '' : ' AND t.owner_id=$1'}`,
      manager ? [] : [user.id],
    );
    return result;
  }
  async list(query: MailListQuery, user: AuthenticatedUser) {
    const params: unknown[] = [];
    const filters = [this.scope(user, params)];
    if (query.view && query.view !== 'mine' && !mailManager(user))
      mailFail('AUTH_FORBIDDEN', '只有主管可查看此视图', 403);
    if (query.view === 'mine')
      filters.push('t.owner_id=$' + params.push(user.id));
    if (query.view === 'unassigned') filters.push('t.owner_id IS NULL');
    if (query.keyword?.trim()) {
      const p =
        '$' +
        params.push(
          '%' + query.keyword.trim().replace(/[\\%_]/g, '\\$&') + '%',
        );
      filters.push(
        `(t.subject ILIKE ${p} OR t.customer_name ILIKE ${p} OR t.customer_email ILIKE ${p})`,
      );
    }
    const where = threadFrom + ' WHERE ' + filters.join(' AND ');
    const [{ total }] = await this.db.query<{ total: number }[]>(
      'SELECT count(*)::int AS total ' + where,
      params,
    );
    const list = await this.db.query<MailThread[]>(
      `SELECT ${columns} ${where} ORDER BY t.last_at DESC,t.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return { list, total, page: query.page, pageSize: query.pageSize };
  }
  async original(m: EntityManager, id: string, source: string) {
    const [msg] = await m.query<MailMessage[]>(
      `SELECT ${messageColumns} FROM mail_messages m WHERE m.thread_id=$1 AND m.id=$2 AND m.direction='inbound'`,
      [id, source],
    );
    if (!msg) mailFail('NOT_FOUND', '所选来信不在此会话中', 404);
    return msg;
  }
  async detail(id: string, user: AuthenticatedUser) {
    return this.db.transaction(async (m) => {
      const t = await this.thread(id, user, m);
      const canWrite = t.ownerId === user.id || mailManager(user);
      const messages = await m.query<MailMessage[]>(
        `SELECT ${messageColumns} FROM mail_messages m WHERE m.thread_id=$1 AND (m.state IN ('received','sent') OR m.actor_id=$2)
       ORDER BY m.occurred_at,m.id`,
        [id, user.id],
      );
      const assignments = mailManager(user)
        ? await m.query<
            {
              actor: string;
              owner: string;
              previousOwner: string | null;
              reason: string;
              at: Date;
            }[]
          >(
            `SELECT u.nickname AS actor,o.nickname AS owner,p.nickname AS "previousOwner",a.reason,a.created_at AS at FROM mail_assignments a
         JOIN users u ON u.id=a.actor_id JOIN users o ON o.id=a.owner_id LEFT JOIN users p ON p.id=a.previous_owner_id WHERE a.thread_id=$1 ORDER BY a.created_at DESC`,
            [id],
          )
        : [];
      const [{ englishName }] = await m.query<{ englishName: string }[]>(
        'SELECT english_name AS "englishName" FROM users WHERE id=$1',
        [user.id],
      );
      return {
        ...t,
        messages,
        assignments,
        signature: englishName?.trim()
          ? mailSignature(englishName.trim())
          : null,
        canReply: canWrite && user.permissions.includes('mail:message:send'),
        canAssign:
          !t.assignmentLocked &&
          mailManager(user) &&
          user.permissions.includes('mail:thread:assign'),
        canCreateInquiry:
          canWrite &&
          !!t.ownerId &&
          !t.inquiryId &&
          user.permissions.includes('mail:inquiry:create') &&
          user.permissions.includes('website:inquiry:create'),
      };
    });
  }
  async markRead(id: string, messageIds: string[], user: AuthenticatedUser) {
    return this.db.transaction(async (m) => {
      const t = await this.thread(id, user, m, true);
      if (t.ownerId === user.id || mailManager(user))
        await m.query(
          "UPDATE mail_messages SET is_read=true WHERE thread_id=$1 AND id=ANY($2::uuid[]) AND direction='inbound' AND NOT is_read",
          [id, messageIds],
        );
      return { id };
    });
  }
  owners(user: AuthenticatedUser) {
    requireMail(user, 'mail:thread:assign');
    if (!mailManager(user)) mailFail('AUTH_FORBIDDEN', '只有主管可分配', 403);
    return this.website.owners(user, 'website');
  }
  async assign(id: string, input: AssignChatDto, user: AuthenticatedUser) {
    requireMail(user, 'mail:thread:assign');
    if (!mailManager(user)) mailFail('AUTH_FORBIDDEN', '只有主管可分配', 403);
    return this.db.transaction(async (m) => {
      const initial = await this.thread(id, user, m);
      const [owner] = await m.query<{ id: string }[]>(
        `SELECT u.id FROM users u WHERE u.id=$1 AND u.status='enabled' AND u.deleted_at IS NULL
       AND EXISTS(SELECT 1 FROM user_identities i JOIN identity_roles ir ON ir.identity_id=i.id JOIN roles r ON r.id=ir.role_id
       WHERE i.user_id=u.id AND i.scope='website' AND r.code='COORDINATOR' AND r.is_enabled=true) FOR SHARE OF u`,
        [input.ownerId],
      );
      if (!owner) mailFail('VALIDATION_ERROR', '请选择启用的独立站计调', 400);
      const [inq] = initial.inquiryId
        ? await m.query<{ version: number }[]>(
            'SELECT version FROM website_inquiries WHERE id=$1 FOR UPDATE',
            [initial.inquiryId],
          )
        : [];
      const t = await this.thread(id, user, m, true);
      mailVersion(t.version, input.version);
      if (t.ownerId === owner.id)
        mailFail('VALIDATION_ERROR', '新负责人不能与当前负责人相同', 400);
      if (t.inquiryId && inq)
        await this.website.transfer(
          t.inquiryId,
          { version: inq.version, ownerId: owner.id, reason: input.reason },
          user,
          m,
        );
      else {
        await assertMailAssignable(m, t);
        await recordMailAssignment(
          m,
          id,
          t.ownerId,
          owner.id,
          input.reason,
          user.id,
        );
      }
      return this.thread(id, user, m);
    });
  }
  async createInquiry(
    id: string,
    source: string,
    input: CreateChatInquiryDto,
    user: AuthenticatedUser,
  ) {
    return this.db.transaction(async (m) => {
      const t = await this.thread(id, user, m, true);
      this.writable(t, user, 'mail:inquiry:create');
      if (!user.permissions.includes('website:inquiry:create'))
        mailFail('AUTH_FORBIDDEN', '没有创建询盘权限', 403);
      const original = await this.original(m, id, source);
      if (t.inquiryId) return { inquiryId: t.inquiryId, created: false };
      mailVersion(t.version, input.version);
      if (!t.ownerId) mailFail('CONFLICT', '请先分配收客计调', 409);
      const [{ receivedAt }] = await m.query<{ receivedAt: string }[]>(
        "SELECT to_char($1::timestamptz AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI') AS \u0022receivedAt\u0022",
        [original.occurredAt],
      );
      const created = await this.website.create(
        {
          ...input,
          businessUnit: 'website',
          ownerId: t.ownerId,
          status: 'new',
          lostReason: '',
          contactInfo: original.replyTo[0]?.email || original.sender.email,
          receivedAt,
          contactChannel: 'Email',
          acquisitionSource: '',
          whatsappSourceId: '',
          websiteInquiryNo: '',
          landingPage: '',
        },
        user,
        m,
      );
      await m.query(
        'UPDATE mail_threads SET inquiry_id=$2,source_message_id=$3,version=version+1 WHERE id=$1',
        [id, created.id, source],
      );
      return { inquiryId: created.id, created: true };
    });
  }
  async download(id: string, file: string, user: AuthenticatedUser) {
    await this.thread(id, user);
    const [row] = await this.db.query<{ key: string | null; name: string }[]>(
      `SELECT a.object_key AS key,a.file_name AS name FROM mail_attachments a JOIN mail_messages m ON m.id=a.message_id
      WHERE m.thread_id=$1 AND a.id=$2 AND a.removed_at IS NULL AND (m.state IN ('received','sent') OR m.actor_id=$3)`,
      [id, file, user.id],
    );
    if (!row) mailFail('NOT_FOUND', '附件不存在或不可访问', 404);
    if (!row.key) mailFail('CONFLICT', '附件正在归档，请稍后再试', 409);
    return this.storage.signDocument(row.key, 'download', row.name);
  }
}
