import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";

export const resourceCalendarRequired = "This resource must be booked from a saved Calendar occurrence.";

export const resourceManagerRequired = "Only resource managers can make new bookings for this resource.";

export function isResourceBookingManager(request: FastifyRequest, allowSchedulerGrant = true) {
  return request.activeDepartmentRole === "site_admin"
    || (request.activeDepartmentPermissions ?? []).includes("resources_manage")
    || (allowSchedulerGrant && (request.activeDepartmentModulePermissions?.["resource-scheduler"] ?? []).includes("manage"));
}

export async function canViewResource(client: Pick<PoolClient, "query">, departmentId: string, groupId: string | null, userId: string, canManage: boolean) {
  if (canManage || !groupId) return true;
  const { rows } = await client.query<{ allowed: boolean }>(
    "SELECT can_view_bookable_resource($1,$2,$3,$4) AS allowed", [departmentId, groupId, userId, canManage],
  );
  return Boolean(rows[0]?.allowed);
}

export async function lockResourceBookingKey(client: PoolClient, departmentId: string, resourceId: string) {
  // Match the capacity trigger's canonical UUID text even when input uses uppercase.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1::uuid::text),hashtext($2::uuid::text))", [departmentId, resourceId]);
}

export async function lockResourceBookingPolicy(client: PoolClient, departmentId: string, resourceId: string) {
  await lockResourceBookingKey(client, departmentId, resourceId);
  const result = await client.query<{ id: string; name: string; requires_approval: boolean; calendar_required: boolean; active: boolean; responsible_user_id: string | null; manager_booking_only: boolean; visibility_group_id: string | null }>(
    "SELECT id,name,requires_approval,calendar_required,active,responsible_user_id,manager_booking_only,visibility_group_id FROM bookable_resources WHERE id=$1 AND department_id=$2",
    [resourceId, departmentId],
  );
  return result.rows[0] ?? null;
}

export async function hasResourceSchedulerCapacityGuard(client: Pick<PoolClient, "query">) {
  const result = await client.query<{ installed: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.resource_bookings'::regclass
       AND tgname='resource_scheduler_capacity_check' AND tgenabled IN ('O','A') AND NOT tgisinternal) AS installed`,
  );
  return Boolean(result.rows[0]?.installed);
}
