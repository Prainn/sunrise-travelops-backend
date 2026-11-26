import { EntityManager } from 'typeorm';
import { mailFail } from './mail.types';

export async function assertMailAssignable(
  manager: EntityManager,
  thread: { id: string; assignmentLocked: boolean },
) {
  if (thread.assignmentLocked)
    mailFail('CONFLICT', '已生成台账或成团，不能改派', 409);
  const [pending] = await manager.query<{ id: string }[]>(
    "SELECT id FROM mail_messages WHERE thread_id=$1 AND state IN ('preparing','sending','unknown') LIMIT 1",
    [thread.id],
  );
  if (pending) mailFail('CONFLICT', '请先核实正在发送的邮件', 409);
}
export async function recordMailAssignment(
  manager: EntityManager,
  id: string,
  previous: string | null,
  owner: string,
  reason: string,
  actor: string,
) {
  await manager.query(
    'UPDATE mail_threads SET owner_id=$2,version=version+1 WHERE id=$1',
    [id, owner],
  );
  await manager.query(
    'INSERT INTO mail_assignments(thread_id,previous_owner_id,owner_id,reason,actor_id) VALUES($1,$2,$3,$4,$5)',
    [id, previous, owner, reason, actor],
  );
}
