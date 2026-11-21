import type { PoolClient } from "pg";

export const resourceCalendarRequired = "This resource must be booked from a saved Calendar occurrence.";

export async function lockResourceBookingPolicy(client: PoolClient, departmentId: string, resourceId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [departmentId, resourceId]);
  const result = await client.query<{ id: string; name: string; requires_approval: boolean; calendar_required: boolean; active: boolean }>(
    "SELECT id,name,requires_approval,calendar_required,active FROM bookable_resources WHERE id=$1 AND department_id=$2",
    [resourceId, departmentId],
  );
  return result.rows[0] ?? null;
}
