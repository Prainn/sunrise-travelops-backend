import { EntityManager } from 'typeorm';
import { CustomerNotes } from '../whatsapp/whatsapp.types';
import { MailCustomerNotesDto } from './mail.dto';
import { mailFail } from './mail.types';
import { validateCustomerNotesLocations } from '../website/customer-notes';

const originalRequirements =
  "left(concat_ws(E'\\n\\n',nullif(m.subject,''),nullif(m.body,'')),200000)";
type MailCustomerNotes = CustomerNotes & {
  conversationId: string;
  version: number;
  customerName: string;
};

export async function readMailCustomerNotes(
  manager: EntityManager,
  thread: string,
  source: string,
) {
  const [notes] = await manager.query<MailCustomerNotes[]>(
    `SELECT t.id AS "conversationId",t.version,
      left(coalesce(t.manual_customer_name,nullif(m.reply_to->0->>'name',''),nullif(m.sender->>'name',''),t.customer_name),100) AS "customerName",
      coalesce(nullif(m.reply_to->0->>'email',''),m.sender->>'email') AS "contactInfo",
      t.country_item_id AS "countryItemId",t.planned_days AS "plannedDays",t.start_date::text AS "startDate",t.pax,t.destinations,
      coalesce(m.customer_requirements,${originalRequirements}) AS requirements,t.internal_remark AS "internalRemark",t.customer_notes_updated_at AS "updatedAt"
      FROM mail_threads t JOIN mail_messages m ON m.thread_id=t.id WHERE t.id=$1 AND m.id=$2 AND m.direction='inbound'`,
    [thread, source],
  );
  if (!notes) mailFail('NOT_FOUND', '所选来信不在此会话中', 404);
  return notes;
}

// The caller holds the thread lock throughout the update and the readback.
export async function writeMailCustomerNotes(
  manager: EntityManager,
  thread: string,
  source: string,
  input: MailCustomerNotesDto,
) {
  const previous = await readMailCustomerNotes(manager, thread, source);
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
      `UPDATE mail_messages m SET customer_requirements=nullif($3,${originalRequirements}) WHERE thread_id=$1 AND id=$2`,
      [thread, source, input.requirements],
    );
  return readMailCustomerNotes(manager, thread, source);
}
