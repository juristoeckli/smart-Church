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

export async function recordResourceBookingReopened(client: PoolClient, departmentId: string, bookingId: string, actorId: string) {
  const storage = await client.query<{ ready: boolean }>("SELECT to_regclass('public.module_notifications') IS NOT NULL AS ready");
  if (!storage.rows[0]?.ready) return;
  await client.query(
    `INSERT INTO module_notifications(id,department_id,recipient_user_id,sender_user_id,kind,title,body,in_app_enabled,email_enabled)
     SELECT $4,booking.department_id,booking.requested_by,$3,'resource_booking','Resource booking awaiting review',
            'The schedule or quantity for your resource booking changed. Open Resources to see the updated request.',true,true
       FROM resource_bookings booking
       JOIN department_memberships membership ON membership.user_id=booking.requested_by AND membership.department_id=booking.department_id
       JOIN app_users account ON account.id=membership.user_id AND account.is_enabled AND NOT account.is_service_user
       WHERE booking.id=$1 AND booking.department_id=$2 AND booking.requested_by<>$3 AND booking.status='requested'`,
    [bookingId, departmentId, actorId, randomUUID()],
  );
  if (await clearResourceBookingRequestNotices(client, departmentId, bookingId)) {
    await recordPendingResourceBookingRequest(client, departmentId, actorId, [bookingId]);
  }
}

export async function recordResourceBookingReassignment(client: PoolClient, departmentId: string, bookingId: string, actorId: string, previousName: string, nextName: string) {
  const storage = await client.query<{ ready: boolean }>(
    "SELECT to_regclass('public.module_notifications') IS NOT NULL AS ready",
  );
  if (!storage.rows[0]?.ready) return;
  await client.query(
    `INSERT INTO module_notifications(id,department_id,recipient_user_id,sender_user_id,kind,title,body,in_app_enabled,email_enabled)
     SELECT $5,booking.department_id,booking.requested_by,$3,'resource_booking','Resource booking reassigned',
            $4,true,true FROM resource_bookings booking
       JOIN department_memberships member ON member.user_id=booking.requested_by AND member.department_id=booking.department_id
       JOIN app_users account ON account.id=member.user_id AND account.is_enabled AND NOT account.is_service_user
      WHERE booking.department_id=$1 AND booking.id=$2 AND booking.requested_by<>$3 AND booking.status='requested'`,
    [departmentId, bookingId, actorId, `Your request for “${previousName}” was moved to “${nextName}” and is awaiting a decision.`, randomUUID()],
  );
  if (await clearResourceBookingRequestNotices(client, departmentId, bookingId)) {
    await recordPendingResourceBookingRequest(client, departmentId, actorId, [bookingId]);
  }
}

async function hasResourceBookingRequestNotices(client: PoolClient) {
  const queue = await client.query<{ ready: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.module_notifications')
      AND attname='resource_request_booking_ids' AND NOT attisdropped) AS ready`,
  );
  return Boolean(queue.rows[0]?.ready);
}

async function clearResourceBookingRequestNotices(client: PoolClient, departmentId: string, bookingId: string) {
  if (!await hasResourceBookingRequestNotices(client)) return false;
  await client.query(
    `UPDATE module_notifications SET resource_request_booking_ids=array_remove(resource_request_booking_ids,$2::uuid)
      WHERE department_id=$1 AND kind='resource_booking_request' AND $2::uuid=ANY(resource_request_booking_ids)`,
    [departmentId, bookingId],
  );
  return true;
}

const resourceReviewer = `
  account.is_enabled AND NOT account.is_service_user AND NOT (account.must_change_password AND account.can_change_password)
  AND (member.role='site_admin' OR 'resources_manage'=ANY(member.permissions)
       OR ('resource-scheduler'=ANY(site.enabled_modules) AND member.module_permissions->'resource-scheduler' ? 'manage'))`;

export async function resourceBookingReviewers(client: Pick<PoolClient, "query">, departmentId: string, userId?: string) {
  return (await client.query<{ id: string; displayName: string }>(
    `SELECT member.user_id AS id,account.display_name AS "displayName"
       FROM department_memberships member
       JOIN app_users account ON account.id=member.user_id
       JOIN departments site ON site.id=member.department_id
      WHERE member.department_id=$1 AND ($2::uuid IS NULL OR member.user_id=$2) AND ${resourceReviewer}
      ORDER BY account.display_name,member.user_id`, [departmentId, userId ?? null],
  )).rows;
}

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
  if (!await hasResourceBookingRequestNotices(client)) return;
  await client.query(
    `WITH reviewers AS (
       SELECT member.user_id FROM department_memberships member
       JOIN app_users account ON account.id=member.user_id
       JOIN departments site ON site.id=member.department_id
       WHERE member.department_id=$1 AND member.user_id<>$2 AND ${resourceReviewer}
     ), pending AS (
       SELECT booking.id,assigned.user_id AS assigned_reviewer
         FROM resource_bookings booking
         JOIN bookable_resources resource ON resource.id=booking.resource_id AND resource.department_id=booking.department_id
         LEFT JOIN reviewers assigned ON assigned.user_id=resource.responsible_user_id
        WHERE booking.department_id=$1 AND booking.id=ANY($3::uuid[])
          AND booking.status='requested' AND booking.ends_at>now()
     )
     INSERT INTO module_notifications(id,department_id,recipient_user_id,sender_user_id,kind,title,body,resource_request_booking_ids)
     SELECT gen_random_uuid(),$1,reviewer.user_id,$2,'resource_booking_request',
            'New resource booking request','A resource booking is waiting for a decision. Open Resources to review pending requests.',
            array_agg(pending.id ORDER BY pending.id)
       FROM reviewers reviewer JOIN pending ON pending.assigned_reviewer IS NULL OR pending.assigned_reviewer=reviewer.user_id
      GROUP BY reviewer.user_id`,
    [departmentId, actorId, bookingIds],
  );
}
