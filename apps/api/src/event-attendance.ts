import type { Pool, PoolClient } from "pg";

export async function lockCheckInEvent(client: Pick<PoolClient, "query">, departmentId: string, eventId: string, localOnly = false) {
  const result = await client.query(
    `SELECT id FROM service_events WHERE department_id=$1 AND id=$2
      ${localOnly ? "AND (source_system IS NULL OR source_system NOT IN ('churchtools','elvanto'))" : ""}
      FOR UPDATE`, [departmentId, eventId],
  );
  return Boolean(result.rowCount);
}

export async function isCheckInComplete(client: Pick<PoolClient, "query">, departmentId: string, eventId: string) {
  const result = await client.query("SELECT 1 FROM check_in_sessions WHERE department_id=$1 AND event_id=$2", [departmentId, eventId]);
  return Boolean(result.rowCount);
}

export const completedCheckInError = "Meeting check-in is complete. Reopen it before changing attendance.";

async function hasPickupRelease(client: PoolClient, departmentId: string, eventId: string, contactId: string) {
  const schema = await client.query<{ installed: boolean }>("SELECT to_regclass('public.check_in_event_pickups') IS NOT NULL AS installed");
  if (!schema.rows[0]?.installed) return false;
  const result = await client.query(
    "SELECT 1 FROM check_in_event_pickups WHERE department_id=$1 AND event_id=$2 AND child_contact_id=$3 AND released_at IS NOT NULL",
    [departmentId, eventId, contactId],
  );
  return Boolean(result.rowCount);
}

type AttendanceWriteResult<T> = { state: "changed"; value: T } | { state: "missing" | "completed" | "released" };

export async function writeCoreEventAttendance<T>(pool: Pool, departmentId: string, eventId: string, contactId: string, write: (client: PoolClient) => Promise<T>): Promise<AttendanceWriteResult<T>> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!await lockCheckInEvent(client, departmentId, eventId, true)) {
      await client.query("ROLLBACK");
      return { state: "missing" };
    }
    if (await isCheckInComplete(client, departmentId, eventId)) {
      await client.query("ROLLBACK");
      return { state: "completed" };
    }
    if (await hasPickupRelease(client, departmentId, eventId, contactId)) {
      await client.query("ROLLBACK");
      return { state: "released" };
    }
    const value = await write(client);
    await client.query("COMMIT");
    return { state: "changed", value };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
