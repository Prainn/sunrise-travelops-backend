import { EntityManager } from 'typeorm';
import { CustomerNotes } from '../whatsapp/whatsapp.types';
import { MailCustomerNotesDto } from './mail.dto';
import { mailFail } from './mail.types';
import { validateCustomerNotesLocations } from '../website/customer-notes';

type MailCustomerNotes = CustomerNotes & {
  conversationId: string;
  version: number;
  customerName: string;
};

async function loadMailCustomerNotes(
  manager: EntityManager,
  thread: string,
  source: string,
) {
  const [row] = await manager.query<
    (MailCustomerNotes & {
      firstMessageId: string;
      originalRequirements: string;
    })[]
  >(
    `SELECT t.id AS "conversationId",t.version,
      left(coalesce(t.manual_customer_name,nullif(m.reply_to->0->>'name',''),nullif(m.sender->>'name',''),t.customer_name),100) AS "customerName",
      coalesce(nullif(m.reply_to->0->>'email',''),m.sender->>'email') AS "contactInfo",
      t.country_item_id AS "countryItemId",t.planned_days AS "plannedDays",t.start_date::text AS "startDate",t.pax,t.destinations,
      first.id AS "firstMessageId",original.requirements AS "originalRequirements",
      coalesce(first.customer_requirements,original.requirements) AS requirements,
      t.internal_remark AS "internalRemark",t.customer_notes_updated_at AS "updatedAt"
      FROM mail_threads t JOIN mail_messages m ON m.thread_id=t.id
      JOIN LATERAL (
        SELECT id,subject,sender,body,authored_body,occurred_at,customer_requirements FROM mail_messages
        WHERE thread_id=t.id AND direction='inbound' ORDER BY occurred_at,id LIMIT 1
      ) first ON true
      LEFT JOIN LATERAL (
        SELECT q.message_id,q.subject,q.body FROM mail_message_quotes q JOIN mail_messages carrier ON carrier.id=q.message_id
        WHERE carrier.thread_id=t.id AND carrier.state IN ('received','sent')
          AND lower(trim(coalesce(substring(q.sender FROM '<([^<>]+@[^<>]+)>'),q.sender)))
            IN (lower(t.customer_email),lower(first.sender->>'email'))
          AND q.sent_at_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$'
          AND q.sent_at_text < to_char(first.occurred_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI')
        ORDER BY q.sent_at_text,carrier.occurred_at,carrier.id,q.position LIMIT 1
      ) quote ON true
      CROSS JOIN LATERAL (
        SELECT left(concat_ws(E'\\n\\n',
          nullif(CASE WHEN quote.message_id IS NULL THEN first.subject ELSE quote.subject END,''),
          nullif(coalesce(quote.body,first.authored_body,first.body),'')),200000) AS requirements
      ) original
      WHERE t.id=$1 AND m.id=$2 AND m.direction='inbound'`,
    [thread, source],
  );
  if (!row) mailFail('NOT_FOUND', '所选来信不在此会话中', 404);
  const { firstMessageId, originalRequirements, ...notes } = row;
  return { firstMessageId, originalRequirements, notes };
}

export async function readMailCustomerNotes(
  manager: EntityManager,
  thread: string,
  source: string,
) {
  const { notes } = await loadMailCustomerNotes(manager, thread, source);
  return notes;
}

// The caller holds the thread lock throughout the update and the readback.
export async function writeMailCustomerNotes(
  manager: EntityManager,
  thread: string,
  source: string,
  input: MailCustomerNotesDto,
) {
  const {
    firstMessageId,
    originalRequirements,
    notes: previous,
  } = await loadMailCustomerNotes(manager, thread, source);
  await validateCustomerNotesLocations(manager, input);
  await manager.query(
    `UPDATE mail_threads SET manual_customer_name=CASE WHEN $2=$3 THEN manual_customer_name ELSE nullif($2,'') END,
      country_item_id=$4,planned_days=$5,start_date=$6,pax=$7,destinations=$8,internal_remark=$9,
      customer_notes_updated_at=now(),version=version+1 WHERE id=$1`,
    [
      thread,
      input.customerName,
      previous.customerName,
      input.countryItemId,
      input.plannedDays,
      input.startDate,
      input.pax,
      input.destinations,
      input.internalRemark,
    ],
  );
  if (input.requirements !== previous.requirements)
    await manager.query(
      `UPDATE mail_messages SET customer_requirements=nullif($3,$4) WHERE thread_id=$1 AND id=$2`,
      [thread, firstMessageId, input.requirements, originalRequirements],
    );
  return readMailCustomerNotes(manager, thread, source);
}
