import { effectiveAccountPermissions } from '../auth/identity-permissions';
import { LoginScope } from '../users/user-identity.entity';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { WebsiteService } from '../website/website.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { WhatsappConfig } from './whatsapp.config';
import { WhatsappProvider } from './whatsapp.provider';
import {
  interaction,
  MessageAlias,
  presentMessages,
} from './whatsapp.presentation';
import {
  AssignChatDto,
  ChatListQuery,
  ChatStateDto,
  CreateChatInquiryDto,
  MessageListQuery,
  MessageSourceDto,
  SendTextDto,
} from './whatsapp.dto';
import {
  ChatAccount,
  ChatMessage,
  Conversation,
  CONVERSATION_COLUMNS,
  CONVERSATION_FROM,
  MESSAGE_COLUMNS,
} from './whatsapp.types';
import {
  assertWindow,
  chatAdmin,
  chatFail,
  chatManager,
  chatPermission,
  chatVersion,
  mutableChat,
  nextMessageStatus,
  sequence,
} from './whatsapp.policy';

@Injectable()
export class WhatsappService {
  constructor(
    private readonly db: DataSource,
    private readonly website: WebsiteService,
    private readonly config: WhatsappConfig,
    private readonly provider: WhatsappProvider,
  ) {}
  private scope(user: AuthenticatedUser, params: unknown[]) {
    chatPermission(user);
    if (chatManager(user)) return 'true';
    const p = params.push(user.id);
    return `(c.owner_id=$${p} OR (c.state='archived' AND EXISTS(SELECT 1 FROM whatsapp_conversations current WHERE current.contact_id=c.contact_id AND current.state<>'archived' AND current.owner_id=$${p})))`;
  }
  async conversation(
    id: string,
    user: AuthenticatedUser,
    manager = this.db.manager,
    lock = false,
  ) {
    const params: unknown[] = [id],
      scope = this.scope(user, params);
    const [row] = await manager.query<Conversation[]>(
      `SELECT ${CONVERSATION_COLUMNS} ${CONVERSATION_FROM} WHERE c.id=$1 AND ${scope}${lock ? ' FOR UPDATE OF c' : ''}`,
      params,
    );
    if (!row) chatFail('NOT_FOUND', '会话不存在或不可访问', 404);
    return row;
  }
  private async audit(
    manager: EntityManager,
    id: string,
    user: AuthenticatedUser,
    action: string,
    details: Record<string, unknown> = {},
  ) {
    await manager.query(
      'INSERT INTO whatsapp_actions(conversation_id,actor_id,action,details) VALUES($1,$2,$3,$4::jsonb)',
      [id, user.id, action, JSON.stringify(details)],
    );
  }
  private async related(manager: EntityManager, c: Conversation) {
    const tours = await manager.query<
      {
        id: string;
        tourNo: string;
        title: string;
        status: string;
        conversationId: string;
      }[]
    >(
      `SELECT t.id,t.tour_no AS "tourNo",coalesce(wi.title,nullif(t.itinerary_summary,''),dl.itinerary,'') AS title,t.status,h.id AS "conversationId"
      FROM whatsapp_conversations h JOIN tours t ON (t.source_module='website' AND t.inquiry_id=h.inquiry_id)
        OR t.direct_ledger_id IN (SELECT id FROM direct_ledgers WHERE website_inquiry_id=h.inquiry_id)
      LEFT JOIN website_itineraries wi ON wi.id=t.itinerary_id LEFT JOIN direct_ledgers dl ON dl.id=t.direct_ledger_id
      WHERE h.contact_id=$1 AND h.created_at<=(SELECT created_at FROM whatsapp_conversations WHERE id=$2) ORDER BY t.created_at DESC,t.id DESC`,
      [c.contactId, c.id],
    );
    const [current] = await manager.query<
      { id: string; ownerId: string | null }[]
    >(
      `SELECT id,owner_id AS "ownerId" FROM whatsapp_conversations WHERE contact_id=$1 AND state<>'archived'`,
      [c.contactId],
    );
    const [ledger] = c.inquiryId
      ? await manager.query<{ id: string; orderNo: string }[]>(
          `SELECT id,order_no AS "orderNo" FROM direct_ledgers WHERE website_inquiry_id=$1`,
          [c.inquiryId],
        )
      : [];
    return {
      tours,
      currentConversationId: current?.id ?? null,
      ledger: ledger ?? null,
    };
  }
  async detail(id: string, user: AuthenticatedUser) {
    const c = await this.conversation(id, user),
      related = await this.related(this.db.manager, c);
    const ownOrManager = chatManager(user) || c.ownerId === user.id;
    const formed = related.tours.some((t) => t.conversationId === c.id);
    return {
      ...c,
      ...related,
      hasFormedTours: related.tours.length > 0,
      replyWindowExpiresAt: c.lastInboundAt
        ? new Date(c.lastInboundAt.getTime() + 86400000).toISOString()
        : null,
      capabilities: {
        canReply:
          c.state === 'open' &&
          ownOrManager &&
          user.permissions.includes('whatsapp:message:send') &&
          !!c.lastInboundAt &&
          Date.now() - c.lastInboundAt.getTime() < 86400000,
        canAssign:
          c.state !== 'archived' &&
          chatManager(user) &&
          !c.assignmentLockedAt &&
          !related.ledger &&
          !formed &&
          user.permissions.includes('whatsapp:conversation:assign'),
        canCreateInquiry:
          c.state !== 'archived' &&
          !!c.ownerId &&
          !c.inquiryId &&
          ownOrManager &&
          user.permissions.includes('whatsapp:inquiry:create') &&
          user.permissions.includes('website:inquiry:create'),
        canStartConsultation:
          c.state !== 'archived' &&
          formed &&
          ownOrManager &&
          user.permissions.includes('whatsapp:conversation:update'),
      },
    };
  }
  async list(query: ChatListQuery, user: AuthenticatedUser) {
    const params: unknown[] = [],
      where = [this.scope(user, params)];
    if (query.view === 'unassigned') {
      if (!chatManager(user))
        chatFail('AUTH_FORBIDDEN', '只有主管可查看未分配会话', 403);
      where.push('c.owner_id IS NULL');
    }
    if (query.view === 'mine')
      where.push(`c.owner_id=$${params.push(user.id)}`);
    if (query.state) where.push(`c.state=$${params.push(query.state)}`);
    else where.push("c.state<>'archived'");
    if (query.ownerId) where.push(`c.owner_id=$${params.push(query.ownerId)}`);
    if (query.accountId)
      where.push(`c.account_id=$${params.push(query.accountId)}`);
    if (query.keyword) {
      const p = params.push(`%${query.keyword.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(
        `(p.name ILIKE $${p} OR p.phone ILIKE $${p} OR p.bsuid ILIKE $${p})`,
      );
    }
    const userParam = params.push(user.id);
    const unread = `(SELECT count(*)::int FROM whatsapp_messages m WHERE m.conversation_id=c.id AND m.direction='inbound' AND NOT EXISTS (SELECT 1 FROM whatsapp_events e WHERE e.message_id=m.id AND e.kind='history_import' AND e.state='done') AND m.seq>coalesce((SELECT last_seq FROM whatsapp_reads r WHERE r.conversation_id=c.id AND r.user_id=$${userParam}),0))`;
    if (query.unread)
      where.push(`${unread}${query.unread === 'true' ? '>0' : '=0'}`);
    where.push(`$${userParam}::uuid IS NOT NULL`);
    const sql = where.join(' AND ');
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(*)::text total ${CONVERSATION_FROM} WHERE ${sql}`,
      params,
    );
    const list = await this.db.query<Conversation[]>(
      `SELECT ${CONVERSATION_COLUMNS},${unread} AS "unreadCount",
      (SELECT CASE WHEN kind='reaction' THEN coalesce(attachment->>'emoji','◌') WHEN kind='edit' THEN attachment#>>'{edit,message,text,body}' ELSE text END FROM whatsapp_messages WHERE conversation_id=c.id ORDER BY occurred_at DESC,seq DESC LIMIT 1) AS "lastMessageText"
      ${CONVERSATION_FROM} WHERE ${sql} ORDER BY c.updated_at DESC,c.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async messages(id: string, query: MessageListQuery, user: AuthenticatedUser) {
    await this.conversation(id, user);
    const params: unknown[] = [id],
      clauses = ['m.conversation_id=$1'];
    if (query.beforeSeq && query.afterSeq)
      chatFail('VALIDATION_ERROR', '不能同时指定beforeSeq和afterSeq', 400);
    if (query.beforeSeq)
      clauses.push(`m.seq<$${params.push(sequence(query.beforeSeq))}::bigint`);
    if (query.afterSeq)
      clauses.push(`m.seq>$${params.push(sequence(query.afterSeq))}::bigint`);
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(*)::text total FROM whatsapp_messages m WHERE ${clauses.join(' AND ')}`,
      params,
    );
    const list = await this.db.query<ChatMessage[]>(
      `SELECT ${MESSAGE_COLUMNS},u.nickname AS "actorName" FROM whatsapp_messages m LEFT JOIN users u ON u.id=m.actor_id
      WHERE ${clauses.join(' AND ')} ORDER BY m.seq ${query.afterSeq ? 'ASC' : 'DESC'} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    const [aliases, changes] = await Promise.all([
      this.db.query<MessageAlias[]>(
        `SELECT m.id,m.provider_id AS "providerId",e.payload->'record'->>'UniqueMessageId' AS "externalId"
         FROM whatsapp_messages m LEFT JOIN whatsapp_events e ON e.message_id=m.id AND e.kind='history_import' AND e.state='done'
         WHERE m.conversation_id=$1`,
        [id],
      ),
      this.db.query<ChatMessage[]>(
        `SELECT ${MESSAGE_COLUMNS} FROM whatsapp_messages m WHERE conversation_id=$1 AND
         (kind IN ('reaction','edit') OR attachment->>'type'='edit')`,
        [id],
      ),
    ]);
    return {
      list: presentMessages(list, aliases, changes),
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async owners(user: AuthenticatedUser) {
    chatPermission(user, 'whatsapp:conversation:assign');
    if (!chatManager(user)) chatFail('AUTH_FORBIDDEN', '只有主管可分配', 403);
    return this.website.owners(user, 'website');
  }
  async assign(id: string, input: AssignChatDto, user: AuthenticatedUser) {
    chatPermission(user, 'whatsapp:conversation:assign');
    if (!chatManager(user)) chatFail('AUTH_FORBIDDEN', '只有主管可分配', 403);
    return this.db.transaction(async (manager) => {
      // All existing inquiry writers acquire inquiry before conversation.
      const initial = await this.conversation(id, user, manager);
      const [owner] = await manager.query<{ name: string }[]>(
        `SELECT u.nickname AS name FROM users u
        WHERE u.id=$1 AND u.status='enabled' AND u.deleted_at IS NULL AND EXISTS(SELECT 1 FROM user_identities i JOIN identity_roles ir ON ir.identity_id=i.id JOIN roles r ON r.id=ir.role_id
        WHERE i.user_id=u.id AND i.scope='website' AND r.code='COORDINATOR' AND r.is_enabled=true) FOR SHARE OF u`,
        [input.ownerId],
      );
      if (!owner) chatFail('VALIDATION_ERROR', '请选择启用的独立站计调', 400);
      const [inquiry] = initial.inquiryId
        ? await manager.query<{ version: number }[]>(
            'SELECT version FROM website_inquiries WHERE id=$1 FOR UPDATE',
            [initial.inquiryId],
          )
        : [];
      const c = await this.conversation(id, user, manager, true);
      mutableChat(c);
      chatVersion(c, input.version);
      if (c.inquiryId !== initial.inquiryId)
        chatFail('CONFLICT', '会话关联已更新，请重试', 409);
      const related = await this.related(manager, c);
      if (
        c.assignmentLockedAt ||
        related.ledger ||
        related.tours.some((t) => t.conversationId === id)
      )
        chatFail('CONFLICT', '已生成台账或成团，不能改派', 409);
      if (c.ownerId === input.ownerId)
        chatFail('VALIDATION_ERROR', '新负责人不能与当前负责人相同', 400);
      if (c.inquiryId && inquiry) {
        await this.website.transfer(
          c.inquiryId,
          {
            version: inquiry.version,
            ownerId: input.ownerId,
            reason: input.reason,
          },
          user,
          manager,
        );
      } else {
        await manager.query(
          'UPDATE whatsapp_conversations SET owner_id=$2,version=version+1,updated_at=now() WHERE id=$1',
          [id, input.ownerId],
        );
      }
      await this.audit(manager, id, user, 'assigned', {
        previousOwnerId: c.ownerId,
        ownerId: input.ownerId,
        reason: input.reason,
      });
      return this.conversation(id, user, manager);
    });
  }
  async setState(id: string, input: ChatStateDto, user: AuthenticatedUser) {
    chatPermission(user, 'whatsapp:conversation:update');
    return this.db.transaction(async (manager) => {
      const c = await this.conversation(id, user, manager, true);
      mutableChat(c);
      chatVersion(c, input.version);
      await manager.query(
        'UPDATE whatsapp_conversations SET state=$2,version=version+1,updated_at=now() WHERE id=$1',
        [id, input.state],
      );
      await this.audit(manager, id, user, input.state);
      return this.conversation(id, user, manager);
    });
  }
  async startConsultation(
    id: string,
    version: number,
    user: AuthenticatedUser,
  ) {
    chatPermission(user, 'whatsapp:conversation:update');
    return this.db.transaction(async (manager) => {
      const initial = await this.conversation(id, user, manager);
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`whatsapp:${initial.accountId}`],
      );
      const c = await this.conversation(id, user, manager, true);
      mutableChat(c);
      chatVersion(c, version);
      const related = await this.related(manager, c);
      if (!related.tours.some((t) => t.conversationId === id))
        chatFail('CONFLICT', '当前咨询尚无成团记录，请继续使用当前咨询', 409);
      const [pending] = await manager.query<{ id: string }[]>(
        `SELECT id FROM whatsapp_messages WHERE conversation_id=$1 AND status IN ('queued','sending','unknown') LIMIT 1`,
        [id],
      );
      if (pending)
        chatFail(
          'CONFLICT',
          '当前咨询存在待发送或结果未知的消息，请先核实',
          409,
        );
      await manager.query(
        `UPDATE whatsapp_conversations SET state='archived',archived_at=now(),version=version+1,updated_at=now() WHERE id=$1`,
        [id],
      );
      const [created] = await manager.query<{ id: string }[]>(
        `INSERT INTO whatsapp_conversations(account_id,contact_id,previous_id) VALUES($1,$2,$3) RETURNING id`,
        [c.accountId, c.contactId, id],
      );
      await this.audit(manager, id, user, 'new_consultation', {
        conversationId: created.id,
      });
      // The new unassigned conversation is visible only to supervisors, even to its creator.
      return {
        id: created.id,
        previousId: id,
        state: 'open',
        ownerId: null,
        canView: chatManager(user),
      };
    });
  }
  async markRead(id: string, lastSeq: string, user: AuthenticatedUser) {
    sequence(lastSeq);
    return this.db.transaction(async (manager) => {
      await this.conversation(id, user, manager, true);
      if (lastSeq !== '0') {
        const [m] = await manager.query<{ id: string }[]>(
          'SELECT id FROM whatsapp_messages WHERE conversation_id=$1 AND seq=$2::bigint',
          [id, lastSeq],
        );
        if (!m) chatFail('VALIDATION_ERROR', '阅读位置不属于当前会话', 400);
      }
      const [row] = await manager.query<{ lastSeq: string }[]>(
        `INSERT INTO whatsapp_reads(conversation_id,user_id,last_seq) VALUES($1,$2,$3::bigint)
        ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_seq=greatest(whatsapp_reads.last_seq,EXCLUDED.last_seq),updated_at=now() RETURNING last_seq::text AS "lastSeq"`,
        [id, user.id, lastSeq],
      );
      return row;
    });
  }
  async prefill(id: string, user: AuthenticatedUser) {
    chatPermission(user, 'whatsapp:inquiry:create');
    const c = await this.conversation(id, user);
    mutableChat(c);
    const [message] = await this.db.query<
      {
        text: string;
        occurredAt: Date;
        sourceReference: string | null;
        websiteInquiryNo: string | null;
        landingPage: string | null;
        acquisitionSource: string | null;
      }[]
    >(
      `SELECT m.text,m.occurred_at AS "occurredAt",s.source_reference AS "sourceReference",s.website_inquiry_no AS "websiteInquiryNo",s.landing_page AS "landingPage",s.acquisition_source AS "acquisitionSource"
      FROM whatsapp_messages m LEFT JOIN whatsapp_message_sources s ON s.message_id=m.id WHERE m.conversation_id=$1 AND m.direction='inbound' ORDER BY m.seq LIMIT 1`,
      [id],
    );
    const receivedAt = message?.occurredAt
      ? new Date(message.occurredAt.getTime() + 28800000)
          .toISOString()
          .slice(0, 16)
          .replace('T', ' ')
      : null;
    return {
      version: c.version,
      inquiryId: c.inquiryId,
      ownerId: c.ownerId,
      input: {
        customerName: c.name,
        contactInfo: c.phone || c.bsuid || '',
        contactChannel: 'WhatsApp',
        receivedAt,
        requirements: message?.text ?? '',
        whatsappSourceId: message?.sourceReference ?? '',
        websiteInquiryNo: message?.websiteInquiryNo ?? '',
        landingPage: message?.landingPage ?? '',
        acquisitionSource: message?.acquisitionSource ?? '',
      },
      requiredFields: [
        'customerName',
        'countryItemId',
        'plannedDays',
        'requirements',
      ],
    };
  }
  async createInquiry(
    id: string,
    input: CreateChatInquiryDto,
    user: AuthenticatedUser,
  ) {
    chatPermission(user, 'whatsapp:inquiry:create');
    return this.db.transaction(async (manager) => {
      const c = await this.conversation(id, user, manager, true);
      mutableChat(c);
      if (c.inquiryId) return { inquiryId: c.inquiryId, created: false };
      chatVersion(c, input.version);
      if (!c.ownerId) chatFail('CONFLICT', '请先分配计调', 409);
      const [source] = await manager.query<
        {
          sourceReference: string;
          websiteInquiryNo: string;
          landingPage: string;
          acquisitionSource: string;
        }[]
      >(
        `SELECT s.source_reference AS "sourceReference",s.website_inquiry_no AS "websiteInquiryNo",s.landing_page AS "landingPage",s.acquisition_source AS "acquisitionSource"
         FROM whatsapp_messages m LEFT JOIN whatsapp_message_sources s ON s.message_id=m.id
         WHERE m.conversation_id=$1 AND m.direction='inbound' ORDER BY m.seq LIMIT 1`,
        [id],
      );
      const inquiry = await this.website.create(
        {
          ...input,
          businessUnit: 'website',
          ownerId: c.ownerId,
          status: 'new',
          lostReason: '',
          contactChannel: 'WhatsApp',
          whatsappSourceId: source?.sourceReference ?? '',
          websiteInquiryNo: source?.websiteInquiryNo ?? '',
          landingPage: source?.landingPage ?? '',
          acquisitionSource: source?.acquisitionSource ?? '',
        },
        user,
        manager,
      );
      await manager.query(
        'UPDATE whatsapp_conversations SET inquiry_id=$2,version=version+1,updated_at=now() WHERE id=$1',
        [id, inquiry.id],
      );
      await this.audit(manager, id, user, 'inquiry_created', {
        inquiryId: inquiry.id,
      });
      return { inquiryId: inquiry.id, created: true };
    });
  }
  async enqueue(
    id: string,
    input: SendTextDto,
    user: AuthenticatedUser,
    retryOf?: string,
    reaction?: { targetMessageId: string; emoji: string },
  ) {
    chatPermission(user, 'whatsapp:message:send');
    return this.db.transaction(async (manager) => {
      const c = await this.conversation(id, user, manager, true);
      const [existing] = await manager.query<ChatMessage[]>(
        `SELECT ${MESSAGE_COLUMNS} FROM whatsapp_messages m WHERE conversation_id=$1 AND client_request_id=$2`,
        [id, input.clientRequestId],
      );
      if (existing) {
        if (
          existing.text !== input.text ||
          existing.kind !== (reaction ? 'reaction' : 'text') ||
          (existing.attachment?.targetMessageId ?? null) !==
            (reaction?.targetMessageId ?? null) ||
          (existing.attachment?.replyToMessageId ?? null) !==
            (input.replyToMessageId ?? null) ||
          existing.actorId !== user.id ||
          existing.retryOf !== (retryOf ?? null)
        )
          chatFail('CONFLICT', '请求编号已被其他消息使用', 409);
        return reaction
          ? presentMessages(
              [existing],
              [
                {
                  id: reaction.targetMessageId,
                  providerId: null,
                  externalId: null,
                },
              ],
              [existing],
            )[0]
          : existing;
      }
      mutableChat(c);
      assertWindow(c.lastInboundAt);
      this.config.assertSend(c.bsuid || c.phone || '');
      if (c.state !== 'open') chatFail('CONFLICT', '请先重新打开会话', 409);
      if (retryOf) {
        const [old] = await manager.query<ChatMessage[]>(
          `SELECT ${MESSAGE_COLUMNS} FROM whatsapp_messages m WHERE id=$1 AND conversation_id=$2 FOR UPDATE`,
          [retryOf, id],
        );
        if (!old || old.source !== 'system' || old.status !== 'failed')
          chatFail('CONFLICT', '仅明确失败的系统消息可以重试', 409);
        const [retried] = await manager.query<{ id: string }[]>(
          'SELECT id FROM whatsapp_messages WHERE retry_of=$1',
          [retryOf],
        );
        if (retried)
          chatFail('CONFLICT', '该消息已经重试，请查看新的发送记录', 409);
      }
      let attachment: Record<string, unknown> | null = null;
      if (input.replyToMessageId) {
        if (reaction)
          chatFail('VALIDATION_ERROR', '表情回应不能同时引用消息', 400);
        const [target] = await manager.query<ChatMessage[]>(
          `SELECT ${MESSAGE_COLUMNS} FROM whatsapp_messages m WHERE id=$1 AND conversation_id=$2`,
          [input.replyToMessageId, id],
        );
        if (!target) chatFail('NOT_FOUND', '消息不存在', 404);
        if (!target.providerId || interaction(target))
          chatFail('CONFLICT', '该消息暂不能引用回复', 409);
        const aliases = await manager.query<MessageAlias[]>(
          `SELECT m.id,m.provider_id AS "providerId",e.payload->'record'->>'UniqueMessageId' AS "externalId"
           FROM whatsapp_messages m LEFT JOIN whatsapp_events e ON e.message_id=m.id AND e.kind='history_import' AND e.state='done'
           WHERE m.id=$1`,
          [target.id],
        );
        const edits = await manager.query<ChatMessage[]>(
          `SELECT ${MESSAGE_COLUMNS} FROM whatsapp_messages m WHERE conversation_id=$1 AND (kind='edit' OR attachment->>'type'='edit')`,
          [id],
        );
        const shown = presentMessages([target], aliases, edits)[0];
        attachment = {
          replyToMessageId: target.id,
          contextMessageId: target.providerId,
          replyTo: {
            id: target.id,
            text: shown.presentation.text.slice(0, 280),
            kind: target.kind,
            direction: target.direction,
            source: target.source,
          },
        };
      }
      if (reaction) {
        const [target] = await manager.query<ChatMessage[]>(
          `SELECT ${MESSAGE_COLUMNS} FROM whatsapp_messages m WHERE id=$1 AND conversation_id=$2`,
          [reaction.targetMessageId, id],
        );
        if (!target) chatFail('NOT_FOUND', '消息不存在', 404);
        if (
          target.direction !== 'inbound' ||
          !target.providerId ||
          interaction(target)
        )
          chatFail('CONFLICT', '只能回应客户的原始消息', 409);
        attachment = { ...reaction, messageId: target.providerId };
      }
      const messageId = randomUUID();
      await manager.query(
        `INSERT INTO whatsapp_messages(id,account_id,conversation_id,task_id,client_request_id,retry_of,direction,source,kind,text,status,actor_id,actor_identity_id,occurred_at,attachment)
        VALUES($1::uuid,$2,$3,$1::text,$4,$5,'outbound','system',$9,$6,'queued',$7,$8,now(),$10::jsonb)`,
        [
          messageId,
          c.accountId,
          id,
          input.clientRequestId,
          retryOf ?? null,
          input.text,
          user.id,
          user.identityId,
          reaction ? 'reaction' : 'text',
          attachment ? JSON.stringify(attachment) : null,
        ],
      );
      await manager.query(
        'UPDATE whatsapp_conversations SET updated_at=now() WHERE id=$1',
        [id],
      );
      await this.audit(
        manager,
        id,
        user,
        retryOf ? 'message_retried' : 'message_queued',
        { messageId, retryOf: retryOf ?? null },
      );
      const [message] = await manager.query<ChatMessage[]>(
        `SELECT ${MESSAGE_COLUMNS} FROM whatsapp_messages m WHERE id=$1`,
        [messageId],
      );
      return reaction
        ? presentMessages(
            [message],
            [
              {
                id: reaction.targetMessageId,
                providerId: null,
                externalId: null,
              },
            ],
            [message],
          )[0]
        : message;
    });
  }
  async retryMessage(
    id: string,
    messageId: string,
    clientRequestId: string,
    user: AuthenticatedUser,
  ) {
    await this.conversation(id, user);
    const [old] = await this.db.query<ChatMessage[]>(
      `SELECT ${MESSAGE_COLUMNS} FROM whatsapp_messages m WHERE id=$1 AND conversation_id=$2`,
      [messageId, id],
    );
    if (!old) chatFail('NOT_FOUND', '消息不存在', 404);
    return this.enqueue(
      id,
      {
        clientRequestId,
        text: old.text,
        replyToMessageId:
          typeof old.attachment?.replyToMessageId === 'string'
            ? old.attachment.replyToMessageId
            : undefined,
      },
      user,
      messageId,
      old.kind === 'reaction'
        ? {
            targetMessageId:
              typeof old.attachment?.targetMessageId === 'string'
                ? old.attachment.targetMessageId
                : '',
            emoji: old.text,
          }
        : undefined,
    );
  }
  async dispatchOne() {
    const job = await this.db.transaction(async (manager) => {
      await manager.query(
        `UPDATE whatsapp_messages SET status='unknown',error_code='SEND_INTERRUPTED',updated_at=now() WHERE status='sending' AND updated_at<now()-interval '2 minutes'`,
      );
      const [m] = await manager.query<ChatMessage[]>(
        `SELECT ${MESSAGE_COLUMNS} FROM whatsapp_messages m WHERE status='queued' ORDER BY seq LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (!m) return null;
      const [c] = await manager.query<Conversation[]>(
        `SELECT ${CONVERSATION_COLUMNS} ${CONVERSATION_FROM} WHERE c.id=$1`,
        [m.conversationId],
      );
      const [a] = await manager.query<ChatAccount[]>(
        `SELECT id,space_id AS "spaceId",waba_id AS "wabaId",phone FROM whatsapp_accounts WHERE id=$1`,
        [m.accountId],
      );
      try {
        mutableChat(c);
        assertWindow(c.lastInboundAt);
        this.config.assertSend(c.bsuid || c.phone || '');
        const configured = this.config.account();
        if (
          a.spaceId !== configured.spaceId ||
          a.phone !== configured.phone ||
          a.wabaId !== configured.wabaId
        )
          throw new Error('ACCOUNT_CHANGED');
        if (
          c.state !== 'open' ||
          !(await this.senderAllowed(manager, m, c.ownerId))
        )
          throw new Error('ACCESS_CHANGED');
      } catch {
        await manager.query(
          `UPDATE whatsapp_messages SET status='failed',error_code='SEND_PRECONDITION_CHANGED',updated_at=now() WHERE id=$1`,
          [m.id],
        );
        return { skip: true } as const;
      }
      await manager.query(
        `UPDATE whatsapp_messages SET status='sending',attempts=attempts+1,updated_at=now() WHERE id=$1`,
        [m.id],
      );
      return { skip: false, m, c, a } as const;
    });
    if (!job) return false;
    if (job.skip) return true;
    const result = await this.provider.send(
      job.a,
      job.c.bsuid || job.c.phone || '',
      job.m.text,
      job.m.id,
      job.m.kind === 'reaction'
        ? {
            messageId:
              typeof job.m.attachment?.messageId === 'string'
                ? job.m.attachment.messageId
                : '',
            emoji: job.m.text,
          }
        : undefined,
      typeof job.m.attachment?.contextMessageId === 'string'
        ? job.m.attachment.contextMessageId
        : undefined,
    );
    await this.db.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`whatsapp:${job.a.id}`],
      );
      const [current] = await manager.query<ChatMessage[]>(
        `SELECT ${MESSAGE_COLUMNS} FROM whatsapp_messages m WHERE id=$1 FOR UPDATE`,
        [job.m.id],
      );
      if (result.status === 'accepted') {
        const [echo] = await manager.query<ChatMessage[]>(
          `SELECT ${MESSAGE_COLUMNS} FROM whatsapp_messages m WHERE account_id=$1 AND provider_id=$2 AND id<>$3 FOR UPDATE`,
          [job.a.id, result.providerId, job.m.id],
        );
        if (echo) {
          if (echo.source !== 'mobile') throw new Error('PROVIDER_ID_CONFLICT');
          await manager.query(
            'UPDATE whatsapp_events SET message_id=$1 WHERE message_id=$2',
            [current.id, echo.id],
          );
          await manager.query(
            'UPDATE whatsapp_message_sources SET message_id=$1 WHERE message_id=$2',
            [current.id, echo.id],
          );
          await manager.query('DELETE FROM whatsapp_messages WHERE id=$1', [
            echo.id,
          ]);
        }
        await manager.query(
          `UPDATE whatsapp_messages SET provider_id=$2,status=$3,updated_at=now() WHERE id=$1`,
          [
            current.id,
            result.providerId,
            nextMessageStatus(current.status, echo?.status ?? 'accepted'),
          ],
        );
        await manager.query(
          `UPDATE whatsapp_events SET state='pending',available_at=now(),attempts=0 WHERE account_id=$1 AND error_code='STATUS_AWAITING_MESSAGE' AND (payload->>'MessageId'=$2 OR payload->>'TaskId'=$3)`,
          [job.a.id, result.providerId, current.id],
        );
      } else if (current.status === 'sending' || current.status === 'unknown') {
        await manager.query(
          'UPDATE whatsapp_messages SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',
          [current.id, result.status, result.errorCode],
        );
      }
      await manager.query(
        'UPDATE whatsapp_conversations SET updated_at=now() WHERE id=$1',
        [current.conversationId],
      );
    });
    return true;
  }
  private async senderAllowed(
    manager: EntityManager,
    message: ChatMessage,
    ownerId: string | null,
  ) {
    const [actor] = await manager.query<
      { id: string; username: string; scope: LoginScope; roles: string[] }[]
    >(
      `SELECT u.id,u.username,i.scope,array_agg(r.code) AS roles FROM users u JOIN user_identities i ON i.user_id=u.id
       JOIN identity_roles ir ON ir.identity_id=i.id JOIN roles r ON r.id=ir.role_id
       WHERE u.id=$1 AND i.id=$2 AND u.status='enabled' AND u.deleted_at IS NULL AND r.is_enabled=true GROUP BY u.id,i.scope`,
      [message.actorId, message.actorIdentityId],
    );
    if (!actor) return false;
    const grants = effectiveAccountPermissions(
      actor.scope,
      actor.roles,
      null,
      actor.username,
    );
    return (
      grants.includes('whatsapp:message:send') &&
      (actor.id === ownerId ||
        actor.roles.includes('BUSINESS_MANAGER') ||
        (actor.scope === 'headquarters' &&
          actor.roles.includes('ROOT') &&
          ['sunrise', 'mango'].includes(actor.username)))
    );
  }
  async source(accountId: string, providerId: string, input: MessageSourceDto) {
    return this.db.transaction(async (manager) => {
      const [m] = await manager.query<ChatMessage[]>(
        `SELECT ${MESSAGE_COLUMNS} FROM whatsapp_messages m WHERE account_id=$1 AND provider_id=$2 AND direction='inbound' FOR UPDATE`,
        [accountId, providerId],
      );
      if (!m) chatFail('NOT_FOUND', '入站消息尚未入库，请稍后重试', 404);
      const [existing] = await manager.query<{ sourceReference: string }[]>(
        `SELECT source_reference AS "sourceReference" FROM whatsapp_message_sources WHERE message_id=$1`,
        [m.id],
      );
      if (existing) {
        if (existing.sourceReference !== input.sourceReference)
          chatFail('CONFLICT', '消息已关联其他来源', 409);
        return { messageId: m.id };
      }
      const inserted = await manager.query<{ message_id: string }[]>(
        `INSERT INTO whatsapp_message_sources(message_id,source_reference,website_inquiry_no,landing_page,acquisition_source) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING message_id`,
        [
          m.id,
          input.sourceReference,
          input.websiteInquiryNo,
          input.landingPage,
          input.acquisitionSource,
        ],
      );
      if (!inserted.length) chatFail('CONFLICT', '来源已关联其他消息', 409);
      return { messageId: m.id };
    });
  }
  async integration(user: AuthenticatedUser) {
    chatPermission(user, 'whatsapp:integration:manage');
    if (!chatAdmin(user))
      chatFail('AUTH_FORBIDDEN', '仅管理员可查看接入状态', 403);
    const [summary] = await this.db.query<
      Record<string, unknown>[]
    >(`SELECT max(received_at) AS "lastReceivedAt",max(processed_at) AS "lastProcessedAt",
      count(*) FILTER(WHERE state='pending')::int AS pending,count(*) FILTER(WHERE state='failed')::int AS failed FROM whatsapp_events`);
    return {
      enabled: this.config.enabled,
      workerEnabled: this.config.workerEnabled,
      receiveMode: this.config.mode,
      sendEnabled: this.config.get('SEND_ENABLED') === 'true',
      ...summary,
    };
  }
  async failedEvents(query: PaginationQueryDto, user: AuthenticatedUser) {
    await this.integration(user);
    const [count] = await this.db.query<{ total: string }[]>(
      `SELECT count(*)::text total FROM whatsapp_events WHERE state='failed'`,
    );
    const list = await this.db.query<Record<string, unknown>[]>(
      `SELECT id,kind,attempts,error_code AS "errorCode",received_at AS "receivedAt" FROM whatsapp_events WHERE state='failed' ORDER BY received_at DESC,id LIMIT $1 OFFSET $2`,
      [query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async retryEvent(id: string, user: AuthenticatedUser) {
    await this.integration(user);
    const rows = await this.db.query<{ id: string }[]>(
      `UPDATE whatsapp_events SET state='pending',attempts=0,available_at=now() WHERE id=$1 AND state='failed' RETURNING id`,
      [id],
    );
    if (!rows.length) chatFail('CONFLICT', '事件不存在或不处于失败状态', 409);
    return { id };
  }
  async actions(
    id: string,
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ) {
    await this.conversation(id, user);
    const [count] = await this.db.query<{ total: string }[]>(
      'SELECT count(*)::text total FROM whatsapp_actions WHERE conversation_id=$1',
      [id],
    );
    const list = await this.db.query<Record<string, unknown>[]>(
      'SELECT id,actor_id AS "actorId",action,details,created_at AS "createdAt" FROM whatsapp_actions WHERE conversation_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',
      [id, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return {
      list,
      total: Number(count.total),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
