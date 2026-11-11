export type MessageStatus =
  | 'received'
  | 'queued'
  | 'sending'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'unknown';
export interface ChatAccount {
  id: string;
  spaceId: string;
  wabaId: string;
  phone: string;
}
export interface Conversation {
  id: string;
  accountId: string;
  contactId: string;
  ownerId: string | null;
  ownerName: string | null;
  inquiryId: string | null;
  state: 'open' | 'closed' | 'archived';
  version: number;
  assignmentLockedAt: Date | null;
  previousId: string | null;
  createdAt: Date;
  archivedAt: Date | null;
  updatedAt: Date;
  name: string;
  phone: string | null;
  bsuid: string | null;
  lastInboundAt: Date | null;
}
export interface ChatMessage {
  id: string;
  seq: string;
  conversationId: string;
  accountId: string;
  providerId: string | null;
  taskId: string | null;
  clientRequestId: string | null;
  retryOf: string | null;
  direction: 'inbound' | 'outbound';
  source: 'customer' | 'mobile' | 'system';
  kind: string;
  text: string;
  attachment: Record<string, unknown> | null;
  status: MessageStatus;
  actorId: string | null;
  actorIdentityId: string | null;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
  errorCode: string | null;
}
export interface CustomerNotes {
  countryItemId: string | null;
  plannedDays: number | null;
  startDate: string | null;
  pax: number | null;
  contactInfo: string;
  destinations: string[];
  requirements: string;
  internalRemark: string;
  updatedAt: Date | null;
}
export const CUSTOMER_NOTES_COLUMNS = `country_item_id AS "countryItemId",planned_days AS "plannedDays",
 start_date::text AS "startDate",pax,contact_info AS "contactInfo",destinations,requirements,
 internal_remark AS "internalRemark",updated_at AS "updatedAt"`;
export const MESSAGE_COLUMNS = `m.id,m.seq::text,m.account_id AS "accountId",m.conversation_id AS "conversationId",
 m.provider_id AS "providerId",m.task_id AS "taskId",m.client_request_id AS "clientRequestId",m.retry_of AS "retryOf",
 m.direction,m.source,m.kind,m.text,m.attachment,m.status,m.actor_id AS "actorId",m.actor_identity_id AS "actorIdentityId",m.occurred_at AS "occurredAt",
 m.created_at AS "createdAt",m.updated_at AS "updatedAt",m.error_code AS "errorCode"`;
export const CONVERSATION_COLUMNS = `c.id,c.account_id AS "accountId",c.contact_id AS "contactId",c.owner_id AS "ownerId",
 u.nickname AS "ownerName",c.inquiry_id AS "inquiryId",c.state,c.version,c.assignment_locked_at AS "assignmentLockedAt",
 c.previous_id AS "previousId",c.created_at AS "createdAt",c.archived_at AS "archivedAt",c.updated_at AS "updatedAt",
 coalesce(p.manual_name,p.name) AS name,p.phone,p.bsuid,p.last_inbound_at AS "lastInboundAt"`;
export const CONVERSATION_FROM = `FROM whatsapp_conversations c JOIN whatsapp_contacts p ON p.id=c.contact_id LEFT JOIN users u ON u.id=c.owner_id`;
