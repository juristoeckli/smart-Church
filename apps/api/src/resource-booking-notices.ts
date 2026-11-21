import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

type Decision = "approved" | "declined" | "cancelled";

export async function recordResourceBookingDecision(client: PoolClient, departmentId: string, bookingId: string, actorId: string, status: Decision) {
  const storage = await client.query<{ ready: boolean }>(
    "SELECT to_regclass('public.module_notifications') IS NOT NULL AS ready",
  );
  if (!storage.rows[0]?.ready) return;
  await client.query(
    `INSERT INTO module_notifications(id,department_id,recipient_user_id,sender_user_id,kind,title,body,in_app_enabled,email_enabled)
     SELECT $5,booking.department_id,booking.requested_by,$3,'resource_booking','Resource booking ' || $4,
            'Your booking for “' || resource.name || '” was ' || $4 || '. Open Resources to view it.',true,true
       FROM resource_bookings booking
       JOIN bookable_resources resource ON resource.id=booking.resource_id AND resource.department_id=booking.department_id
       JOIN department_memberships member ON member.user_id=booking.requested_by AND member.department_id=booking.department_id
       JOIN app_users account ON account.id=member.user_id AND account.is_enabled AND NOT account.is_service_user
      WHERE booking.department_id=$1 AND booking.id=$2 AND booking.requested_by<>$3 AND booking.status=$4`,
    [departmentId, bookingId, actorId, status, randomUUID()],
  );
}

const resourceReviewer = `
  account.is_enabled AND NOT account.is_service_user AND NOT (account.must_change_password AND account.can_change_password)
  AND (member.role='site_admin' OR 'resources_manage'=ANY(member.permissions)
       OR ('resource-scheduler'=ANY(site.enabled_modules) AND member.module_permissions->'resource-scheduler' ? 'manage'))`;

export const activeResourceBookingRequestNotice = `(notification.kind<>'resource_booking_request' OR (
  EXISTS (
    SELECT 1 FROM department_memberships member
    JOIN app_users account ON account.id=member.user_id
    JOIN departments site ON site.id=member.department_id
    WHERE member.department_id=notification.department_id AND member.user_id=notification.recipient_user_id
      AND ${resourceReviewer}
  ) AND EXISTS (
    SELECT 1 FROM resource_bookings booking
    WHERE booking.department_id=notification.department_id AND booking.id=ANY(notification.resource_request_booking_ids)
      AND booking.status='requested' AND booking.ends_at>now()
  )
))`;

export async function recordPendingResourceBookingRequest(
  client: PoolClient, departmentId: string, actorId: string, bookingIds: string[],
) {
  if (!bookingIds.length) return;
  const storage = await client.query<{ ready: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.module_notifications')
         AND attname='resource_request_booking_ids' AND NOT attisdropped
     ) AS ready`,
  );
  if (!storage.rows[0]?.ready) return;
  await client.query(
    `INSERT INTO module_notifications(id,department_id,recipient_user_id,sender_user_id,kind,title,body,resource_request_booking_ids)
     SELECT gen_random_uuid(),member.department_id,member.user_id,$2,'resource_booking_request',
            'New resource booking request','A resource booking is waiting for a decision. Open Resources to review pending requests.',$3::uuid[]
       FROM department_memberships member
       JOIN app_users account ON account.id=member.user_id
       JOIN departments site ON site.id=member.department_id
      WHERE member.department_id=$1 AND member.user_id<>$2 AND ${resourceReviewer}
        AND EXISTS (SELECT 1 FROM resource_bookings booking WHERE booking.department_id=$1 AND booking.id=ANY($3::uuid[])
                    AND booking.status='requested' AND booking.ends_at>now())`,
    [departmentId, actorId, bookingIds],
  );
}
