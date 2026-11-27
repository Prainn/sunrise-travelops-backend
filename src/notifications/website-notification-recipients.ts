import { EntityManager } from 'typeorm';
import { effectiveAccountPermissions } from '../auth/identity-permissions';

export interface NotificationRecipient {
  id: string;
  openId: string;
  username: string;
  roles: string[];
}

export function eligibleWebsiteNotificationRecipient(
  row: NotificationRecipient,
  ownerId: string | null,
  permission: string,
) {
  return (
    (!ownerId || ownerId === row.id) &&
    row.roles.includes(ownerId ? 'COORDINATOR' : 'BUSINESS_MANAGER') &&
    effectiveAccountPermissions(
      'website',
      row.roles,
      null,
      row.username,
    ).includes(permission)
  );
}

export async function websiteNotificationRecipients(
  manager: EntityManager,
  ownerId: string | null,
  permission: string,
) {
  const rows = await manager.query<NotificationRecipient[]>(
    `SELECT u.id,u.username,u.feishu_open_id AS "openId",array_agg(DISTINCT r.code) AS roles
     FROM users u JOIN user_identities i ON i.user_id=u.id JOIN identity_roles ir ON ir.identity_id=i.id JOIN roles r ON r.id=ir.role_id AND r.is_enabled
     WHERE u.status='enabled' AND u.deleted_at IS NULL AND btrim(u.feishu_open_id)<>'' AND i.scope='website'
     AND ($1::uuid IS NULL OR u.id=$1) GROUP BY u.id,i.id ORDER BY u.id`,
    [ownerId],
  );
  return rows.filter((row) =>
    eligibleWebsiteNotificationRecipient(row, ownerId, permission),
  );
}
