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
