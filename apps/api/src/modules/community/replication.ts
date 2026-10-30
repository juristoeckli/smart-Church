import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type GroupJoinRequest = Record<string, unknown>;
type Snapshot = { version: 2; groupJoinRequests: GroupJoinRequest[] };
const maxSnapshotBytes = 50 * 1024 * 1024;

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}

function remapReviewer(row: GroupJoinRequest, userIdMap: Map<string, string>) {
  const copy = { ...row };
  if (typeof copy.reviewed_by === "string") copy.reviewed_by = userIdMap.get(copy.reviewed_by) ?? copy.reviewed_by;
  return copy;
}

export function registerCommunityReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  context.replication.register({
    schemaVersion: "2",
    inspect: async (departmentId) => {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["Community database is unavailable."], recordCount: 0 };
      try {
        const result = await pool.query<{ count: string; bytes: string }>(`SELECT count(*)::text AS count,
            COALESCE(sum(pg_column_size(request)),0)::text AS bytes
          FROM group_join_requests request WHERE request.department_id=$1`, [departmentId]);
        const row = result.rows[0];
        const blockers = Number(row.bytes) > maxSnapshotBytes ? ["Community group-join requests exceed the 50 MiB snapshot limit."] : [];
        return { ready: !blockers.length, blockers, recordCount: Number(row.count) };
      } catch {
        return { ready: false, blockers: ["Community group-join request storage is not initialized on this server."], recordCount: 0 };
      }
    },
    exportSnapshot: async (client: PoolClient, departmentId) => {
      const result = await client.query(`SELECT id,department_id,group_id,first_name,last_name,email,status,contact_id,created_at,reviewed_at,reviewed_by
        FROM group_join_requests WHERE department_id=$1 ORDER BY created_at,id`, [departmentId]);
      return { version: 2, groupJoinRequests: result.rows };
    },
    restoreSnapshot: async (client: PoolClient, departmentId, input, restoreContext) => {
      const snapshot = input as Snapshot;
      if (!snapshot || snapshot.version !== 2 || !Array.isArray(snapshot.groupJoinRequests) || snapshot.groupJoinRequests.length > 100_000 || Buffer.byteLength(JSON.stringify(snapshot)) > maxSnapshotBytes) throw new Error("The Community group-join request snapshot is invalid or exceeds the supported limits.");
      await client.query("DELETE FROM group_join_requests WHERE department_id=$1", [departmentId]);
      for (const source of snapshot.groupJoinRequests) {
        if (typeof source.id !== "string" || typeof source.group_id !== "string" || typeof source.first_name !== "string" || typeof source.last_name !== "string" || typeof source.email !== "string" || !["pending", "approved", "declined"].includes(String(source.status))) throw new Error("The Community snapshot contains an invalid group-join request.");
        const row = remapReviewer(source, restoreContext.userIdMap);
        await client.query(`INSERT INTO group_join_requests(id,department_id,group_id,first_name,last_name,email,status,contact_id,created_at,reviewed_at,reviewed_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [row.id, departmentId, row.group_id, row.first_name, row.last_name, row.email, row.status, row.contact_id, row.created_at, row.reviewed_at, row.reviewed_by]);
      }
      return { recordCount: snapshot.groupJoinRequests.length };
    },
    verifySnapshot: async (client: PoolClient, departmentId, input, restoreContext) => {
      const snapshot = input as Snapshot;
      if (!snapshot || snapshot.version !== 2 || !Array.isArray(snapshot.groupJoinRequests)) return { ready: false, blockers: ["No supported Community group-join request snapshot is available."] };
      const actual = (await client.query(`SELECT id,department_id,group_id,first_name,last_name,email,status,contact_id,created_at,reviewed_at,reviewed_by
        FROM group_join_requests WHERE department_id=$1 ORDER BY created_at,id`, [departmentId])).rows as GroupJoinRequest[];
      const expectedRows = snapshot.groupJoinRequests.map((row) => canonical(remapReviewer(row, restoreContext?.userIdMap ?? new Map()))).sort();
      const actualRows = actual.map(canonical).sort();
      const matches = expectedRows.length === actualRows.length && expectedRows.every((row, index) => row === actualRows[index]);
      return matches ? { ready: true, blockers: [] } : { ready: false, blockers: ["Community group-join requests differ from the source snapshot after restore."] };
    },
  });
}
