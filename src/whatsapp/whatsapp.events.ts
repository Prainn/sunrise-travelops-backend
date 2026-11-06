import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { WhatsappConfig } from './whatsapp.config';
import {
  ChatAccount,
  ChatMessage,
  MESSAGE_COLUMNS,
  MessageStatus,
} from './whatsapp.types';
import { chatFail, nextMessageStatus } from './whatsapp.policy';

type ObjectValue = Record<string, unknown>;
export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_EVENT');
  return value as ObjectValue;
}
function field(o: ObjectValue, k: string, required = false): string {
  const value = o[k];
  if (value === undefined || value === null) {
    if (required) throw new Error('INVALID_EVENT');
    return '';
  }
  if (typeof value !== 'string' || value.length > 1000 || (required && !value))
    throw new Error('INVALID_EVENT');
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) => `${JSON.stringify(k)}:${canonical((value as ObjectValue)[k])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
}
export function eventKey(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function normalizeEvent(
  raw: unknown,
  kind: string,
  account: ChatAccount,
) {
  const p = object(raw),
    providerId = field(p, 'MessageId', true);
  for (const [key, expected] of [
    ['CustSpaceId', account.spaceId],
    ['WabaId', account.wabaId],
  ])
    if (p[key] !== undefined && p[key] !== expected)
      throw new Error('ACCOUNT_MISMATCH');
  const timestamp = p.Timestamp;
  if (
    typeof timestamp !== 'number' ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    timestamp > Date.now() + 60000
  )
    throw new Error('INVALID_TIMESTAMP');
  const occurredAt = new Date(timestamp);
  const isStatus = kind === 'status';
  const notice = field(p, 'NoticeType');
  if (!isStatus && notice && !['inbound', 'echos'].includes(notice))
    throw new Error('UNSUPPORTED_EVENT');
  const echo = !isStatus && notice === 'echos';
  const from = field(p, 'From').replace(/^\+/, ''),
    to = field(p, 'To').replace(/^\+/, '');
  const businessPhone = isStatus
    ? field(p, 'OriginPhoneNumber').replace(/^\+/, '') || from
    : echo
      ? from
      : to;
  if (businessPhone !== account.phone) throw new Error('ACCOUNT_MISMATCH');
  const external = isStatus || echo ? to : from;
  const bsuid =
    field(p, isStatus || echo ? 'UserId' : 'FromUserId') ||
    (/^[A-Z]{2}\.[A-Za-z0-9.]+$/.test(external) ? external : '');
  const phone = /^\d{5,20}$/.test(external) ? external : '';
  if (!isStatus && !bsuid && !phone) throw new Error('MISSING_IDENTITY');
  const statuses: Record<string, MessageStatus> = {
    Sent: 'sent',
    Delivered: 'delivered',
    Read: 'read',
    Failed: 'failed',
  };
  if (isStatus && !statuses[field(p, 'Status')])
    throw new Error('UNSUPPORTED_STATUS');
  const messageKind = isStatus
    ? 'status'
    : field(p, 'Type', true).toLowerCase();
  let text = '',
    attachment: ObjectValue | null = null;
  if (!isStatus) {
    if (messageKind === 'text') {
      if (typeof p.Message !== 'string' || p.Message.length > 200000)
        throw new Error('INVALID_MESSAGE');
      text = p.Message;
    } else {
      attachment = object(
        typeof p.Message === 'string'
          ? (JSON.parse(p.Message) as unknown)
          : p.Message,
      );
    }
  }
  return {
    providerId,
    occurredAt,
    echo,
    isStatus,
    bsuid,
    phone,
    name: field(p, 'Name') || (!echo ? field(p, 'DisplayName') : ''),
    status: statuses[field(p, 'Status')],
    taskId: field(p, 'TaskId'),
    messageKind,
    text,
    attachment,
  };
}
@Injectable()
export class WhatsappEvents {
  constructor(
    private readonly db: DataSource,
    private readonly config: WhatsappConfig,
  ) {}
  async account(manager = this.db.manager): Promise<ChatAccount> {
    const a = this.config.account();
    const [row] = await manager.query<ChatAccount[]>(
      `INSERT INTO whatsapp_accounts(space_id,waba_id,phone) VALUES($1,$2,$3)
      ON CONFLICT(space_id,phone) DO UPDATE SET waba_id=whatsapp_accounts.waba_id
      RETURNING id,space_id AS "spaceId",waba_id AS "wabaId",phone`,
      [a.spaceId, a.wabaId, a.phone],
    );
    if (row.wabaId !== a.wabaId)
      chatFail('CONFLICT', 'WhatsApp账号配置与已登记账号不一致', 409);
    return row;
  }
  async receive(payload: unknown, kind: 'inbound' | 'status') {
    const batch: unknown[] = Array.isArray(payload)
      ? (payload as unknown[])
      : [payload];
    const serialized = JSON.stringify(payload);
    if (
      serialized === undefined ||
      !batch.length ||
      batch.length > 100 ||
      Buffer.byteLength(serialized) > 1024 * 1024
    )
      chatFail('VALIDATION_ERROR', '回调批次大小无效', 400);
    return this.db.transaction(async (manager) => {
      const account = await this.account(manager);
      for (const raw of batch) {
        await manager.query(
          `INSERT INTO whatsapp_events(account_id,event_key,payload,kind) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT DO NOTHING`,
          [account.id, eventKey({ kind, raw }), JSON.stringify(raw), kind],
        );
      }
      return { accepted: batch.length };
    });
  }
  async processOne(): Promise<boolean> {
    return this.db.transaction(async (manager) => {
      const [event] = await manager.query<
        {
          id: string;
          accountId: string;
          payload: unknown;
          kind: string;
          attempts: number;
        }[]
      >(`SELECT id,account_id AS "accountId",payload,kind,attempts FROM whatsapp_events
        WHERE state='pending' AND available_at<=now() ORDER BY received_at,id FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!event) return false;
      const [account] = await manager.query<ChatAccount[]>(
        `SELECT id,space_id AS "spaceId",waba_id AS "wabaId",phone FROM whatsapp_accounts WHERE id=$1`,
        [event.accountId],
      );
      // Savepoint ensures malformed events are durably quarantined without partial business writes.
      await manager.query('SAVEPOINT whatsapp_event');
      try {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          [`whatsapp:${account.id}`],
        );
        const e = normalizeEvent(event.payload, event.kind, account);
        const messageId = e.isStatus
          ? await this.status(manager, account, e)
          : await this.message(manager, account, e);
        await manager.query(
          `UPDATE whatsapp_events SET state='done',attempts=attempts+1,processed_at=now(),message_id=$2,error_code=NULL WHERE id=$1`,
          [event.id, messageId],
        );
      } catch (error) {
        await manager.query('ROLLBACK TO SAVEPOINT whatsapp_event');
        const code =
          error instanceof Error &&
          [
            'INVALID_EVENT',
            'ACCOUNT_MISMATCH',
            'INVALID_TIMESTAMP',
            'UNSUPPORTED_EVENT',
            'MISSING_IDENTITY',
            'UNSUPPORTED_STATUS',
            'INVALID_MESSAGE',
            'IDENTITY_CONFLICT',
            'STATUS_AWAITING_MESSAGE',
            'UNSUPPORTED_IDENTITY_CHANGE',
          ].includes(error.message)
            ? error.message
            : 'EVENT_PROCESSING_FAILED';
        const retry =
          ['STATUS_AWAITING_MESSAGE', 'EVENT_PROCESSING_FAILED'].includes(
            code,
          ) && event.attempts < 7;
        await manager.query(
          `UPDATE whatsapp_events SET state=$2,attempts=attempts+1,error_code=$3,available_at=now()+($4::int*interval '1 second') WHERE id=$1`,
          [
            event.id,
            retry ? 'pending' : 'failed',
            code,
            Math.min(300, 2 ** event.attempts * 5),
          ],
        );
      }
      return true;
    });
  }
  private async status(
    manager: EntityManager,
    account: ChatAccount,
    e: ReturnType<typeof normalizeEvent>,
  ) {
    const rows = await manager.query<ChatMessage[]>(
      `SELECT ${MESSAGE_COLUMNS} FROM whatsapp_messages m WHERE account_id=$1 AND (provider_id=$2 OR (task_id=$3 AND $3<>'')) FOR UPDATE`,
      [account.id, e.providerId, e.taskId],
    );
    if (!rows.length) throw new Error('STATUS_AWAITING_MESSAGE');
    // If echo raced the send response, consolidate its provider row into the system outbox row.
    const message = rows.find((x) => x.source === 'system') ?? rows[0];
    const echo = rows.find((x) => x.id !== message.id);
    if (echo) {
      if (echo.source !== 'mobile' || message.source !== 'system')
        throw new Error('IDENTITY_CONFLICT');
      await manager.query(
        'UPDATE whatsapp_events SET message_id=$1 WHERE message_id=$2',
        [message.id, echo.id],
      );
      await manager.query(
        'UPDATE whatsapp_message_sources SET message_id=$1 WHERE message_id=$2',
        [message.id, echo.id],
      );
      await manager.query('DELETE FROM whatsapp_messages WHERE id=$1', [
        echo.id,
      ]);
    }
    if (message.direction !== 'outbound') throw new Error('INVALID_EVENT');
    const status = nextMessageStatus(message.status, e.status);
    await manager.query(
      `UPDATE whatsapp_messages SET provider_id=$2,status=$3,error_code=CASE WHEN $3='failed' THEN 'PROVIDER_DELIVERY_FAILED' ELSE NULL END,updated_at=now() WHERE id=$1`,
      [message.id, e.providerId, status],
    );
    await manager.query(
      'UPDATE whatsapp_conversations SET updated_at=now() WHERE id=$1',
      [message.conversationId],
    );
    return message.id;
  }
  private async message(
    manager: EntityManager,
    account: ChatAccount,
    e: ReturnType<typeof normalizeEvent>,
  ) {
    const [existing] = await manager.query<{ id: string }[]>(
      'SELECT id FROM whatsapp_messages WHERE account_id=$1 AND provider_id=$2',
      [account.id, e.providerId],
    );
    if (existing) return existing.id;
    // A system identity-change event cannot safely be treated as a new customer.
    if (e.messageKind === 'system')
      throw new Error('UNSUPPORTED_IDENTITY_CHANGE');
    const identities = await manager.query<
      { contactId: string; bsuid: string | null }[]
    >(
      `SELECT DISTINCT i.contact_id AS "contactId",c.bsuid FROM whatsapp_identities i JOIN whatsapp_contacts c ON c.id=i.contact_id
      WHERE i.account_id=$1 AND ((i.kind='bsuid' AND i.value=$2 AND $2<>'') OR (i.kind='phone' AND i.value=$3 AND $3<>''))`,
      [account.id, e.bsuid, e.phone],
    );
    if (
      identities.length > 1 ||
      (identities[0]?.bsuid && e.bsuid && identities[0].bsuid !== e.bsuid)
    )
      throw new Error('IDENTITY_CONFLICT');
    const contactId = identities[0]?.contactId ?? randomUUID();
    await manager.query(
      `INSERT INTO whatsapp_contacts(id,account_id,name,bsuid,phone,last_inbound_at) VALUES($1,$2,$3,nullif($4,''),nullif($5,''),$6)
      ON CONFLICT(id) DO UPDATE SET name=CASE WHEN EXCLUDED.name='' THEN whatsapp_contacts.name ELSE EXCLUDED.name END,
      bsuid=coalesce(EXCLUDED.bsuid,whatsapp_contacts.bsuid),phone=coalesce(EXCLUDED.phone,whatsapp_contacts.phone),
      last_inbound_at=greatest(whatsapp_contacts.last_inbound_at,EXCLUDED.last_inbound_at),updated_at=now()`,
      [
        contactId,
        account.id,
        e.name,
        e.bsuid,
        e.phone,
        e.echo ? null : new Date(Math.min(e.occurredAt.getTime(), Date.now())),
      ],
    );
    for (const [kind, value] of [
      ['bsuid', e.bsuid],
      ['phone', e.phone],
    ])
      if (value)
        await manager.query(
          `INSERT INTO whatsapp_identities(account_id,kind,value,contact_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [account.id, kind, value, contactId],
        );
    // Timestamp routing preserves delayed old events after a new consultation has begun.
    let [conversation] = await manager.query<{ id: string; state: string }[]>(
      `SELECT id,state FROM whatsapp_conversations WHERE contact_id=$1 AND (archived_at IS NULL OR date_trunc('milliseconds',archived_at)>$2)
      ORDER BY created_at,id LIMIT 1 FOR UPDATE`,
      [contactId, e.occurredAt],
    );
    if (!conversation) {
      const [created] = await manager.query<{ id: string; state: string }[]>(
        `INSERT INTO whatsapp_conversations(account_id,contact_id) VALUES($1,$2) RETURNING id,state`,
        [account.id, contactId],
      );
      conversation = created;
    }
    const id = randomUUID();
    await manager.query(
      `INSERT INTO whatsapp_messages(id,account_id,conversation_id,provider_id,direction,source,kind,text,attachment,status,occurred_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
      [
        id,
        account.id,
        conversation.id,
        e.providerId,
        e.echo ? 'outbound' : 'inbound',
        e.echo ? 'mobile' : 'customer',
        e.messageKind,
        e.text,
        JSON.stringify(e.attachment),
        e.echo ? 'sent' : 'received',
        e.occurredAt,
      ],
    );
    await manager.query(
      `UPDATE whatsapp_conversations SET state=CASE WHEN state='closed' AND $2 THEN 'open' ELSE state END,
      version=version+CASE WHEN state='closed' AND $2 THEN 1 ELSE 0 END,updated_at=now() WHERE id=$1`,
      [conversation.id, !e.echo],
    );
    // Status may have arrived first. Replay only the matching unresolved events.
    await manager.query(
      `UPDATE whatsapp_events SET state='pending',available_at=now(),attempts=0 WHERE account_id=$1 AND error_code='STATUS_AWAITING_MESSAGE' AND payload->>'MessageId'=$2`,
      [account.id, e.providerId],
    );
    return id;
  }
}
