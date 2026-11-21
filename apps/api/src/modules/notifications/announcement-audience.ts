import type { Pool } from "pg";

export type AnnouncementAudience = "location" | "groups";

const recipients = `SELECT membership.user_id
  FROM department_memberships membership
 WHERE membership.department_id=$1
   AND ($2::text='location' OR EXISTS (
     SELECT 1 FROM church_groups selected
     JOIN group_members member ON member.group_id=selected.id AND member.status='active'
     JOIN contacts person ON person.id=member.contact_id AND person.department_id=selected.department_id
     WHERE selected.department_id=membership.department_id AND selected.id=ANY($3::uuid[])
       AND person.id=membership.contact_id
   ))`;

export async function getAnnouncementRecipientIds(pool: Pick<Pool, "query">, departmentId: string, audience: AnnouncementAudience, groupIds: string[]) {
  return (await pool.query<{ user_id: string }>(recipients, [departmentId, audience, groupIds])).rows;
}

export async function getAnnouncementAudienceCounts(pool: Pick<Pool, "query">, departmentId: string, audience: AnnouncementAudience, groupIds: string[]) {
  const { rows: [counts] } = await pool.query<{ accountCount: number; emailEligibleCount: number }>(
    `SELECT count(*)::integer AS "accountCount", count(*) FILTER (
              WHERE account.email IS NOT NULL AND preference.email_notifications_enabled=true AND suppressed.email IS NULL
            )::integer AS "emailEligibleCount"
       FROM (${recipients}) recipient
       JOIN app_users account ON account.id=recipient.user_id
       LEFT JOIN module_notification_preferences preference ON preference.department_id=$1 AND preference.user_id=recipient.user_id
       LEFT JOIN module_notification_email_suppressions suppressed ON suppressed.email=lower(trim(account.email))`,
    [departmentId, audience, groupIds],
  );
  return counts;
}
