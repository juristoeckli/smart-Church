import type { Pool, PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type Row = Record<string, unknown>;
type Snapshot = { version: 1; flows: Row[]; steps: Row[]; enrollments: Row[]; progress: Row[]; audit: Row[] };
type TableKey = "flows" | "steps" | "enrollments" | "progress" | "audit";
const maxSnapshotBytes = 50 * 1024 * 1024;
const maxRows = 250_000;

const tables: Array<{ key: TableKey; table: string; columns: string[]; order: string; userColumns: string[] }> = [
  { key: "flows", table: "people_flows", columns: ["id","department_id","name","description","status","created_by","created_at","updated_at"], order: "created_at,id", userColumns: ["created_by"] },
  { key: "steps", table: "people_flow_steps", columns: ["id","department_id","flow_id","title","instructions","position","due_after_days","required","active","created_by","created_at","updated_at"], order: "flow_id,position,id", userColumns: ["created_by"] },
  { key: "enrollments", table: "people_flow_enrollments", columns: ["id","department_id","flow_id","contact_id","status","due_on","started_at","completed_at","created_by","updated_at"], order: "flow_id,contact_id,id", userColumns: ["created_by"] },
  { key: "progress", table: "people_flow_step_progress", columns: ["id","department_id","enrollment_id","step_id","status","due_on","completed_at","updated_by","updated_at"], order: "enrollment_id,step_id,id", userColumns: ["updated_by"] },
  { key: "audit", table: "people_flow_audit", columns: ["id","department_id","actor_user_id","action","flow_id","enrollment_id","step_id","metadata","created_at"], order: "created_at,id", userColumns: ["actor_user_id"] },
];

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value as Row).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Row)[key])).join(",") + "}";
  return JSON.stringify(value);
}
function remapRow(source: Row, userIdMap: Map<string, string>, departmentId?: string): Row {
  const row = { ...source };
  if (departmentId) row.department_id = departmentId;
  for (const column of tables.flatMap((table) => table.userColumns)) {
    if (typeof row[column] === "string") row[column] = userIdMap.get(row[column] as string) ?? row[column];
  }
  return row;
}
function readSnapshot(input: unknown): Snapshot {
  if (!input || typeof input !== "object") throw new Error("The People Flows snapshot is invalid.");
  const value = input as Partial<Snapshot>;
  const keys: TableKey[] = ["flows","steps","enrollments","progress","audit"];
  if (value.version !== 1 || keys.some((key) => !Array.isArray(value[key]))) throw new Error("The People Flows snapshot has an unsupported format.");
  const rows = keys.map((key) => value[key] as Row[]);
  if (rows.reduce((count, table) => count + table.length, 0) > maxRows || rows.some((table) => table.some((row) => !row || typeof row !== "object" || Array.isArray(row))) || Buffer.byteLength(JSON.stringify(input)) > maxSnapshotBytes) {
    throw new Error("The People Flows snapshot exceeds the supported size or contains invalid rows.");
  }
  return value as Snapshot;
}
async function loadRows(client: Pool | PoolClient, departmentId: string): Promise<Snapshot> {
  const data: Partial<Record<TableKey, Row[]>> = {};
  for (const descriptor of tables) {
    const selected = await client.query(`SELECT ${descriptor.columns.join(",")} FROM ${descriptor.table} WHERE department_id=$1 ORDER BY ${descriptor.order}`, [departmentId]);
    data[descriptor.key] = selected.rows as Row[];
  }
  return { version: 1, flows: data.flows ?? [], steps: data.steps ?? [], enrollments: data.enrollments ?? [], progress: data.progress ?? [], audit: data.audit ?? [] };
}

export function registerPeopleFlowsReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  context.replication.register({
    schemaVersion: "1",
    inspect: async (departmentId) => {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["People Flows database is unavailable."], recordCount: 0 };
      try {
        let recordCount = 0;
        let approximateBytes = 0;
        for (const descriptor of tables) {
          const result = await pool.query<{ count: string; bytes: string }>(`SELECT count(*)::text AS count,COALESCE(sum(pg_column_size(to_jsonb(row_data))),0)::text AS bytes FROM ${descriptor.table} row_data WHERE department_id=$1`, [departmentId]);
          recordCount += Number(result.rows[0]?.count ?? 0);
          approximateBytes += Number(result.rows[0]?.bytes ?? 0);
        }
        const blockers = recordCount > maxRows || approximateBytes > maxSnapshotBytes ? ["People Flow records exceed the 50 MiB replication snapshot limit."] : [];
        return { ready: blockers.length === 0, blockers, recordCount };
      } catch {
        return { ready: false, blockers: ["People Flow storage is not initialized on this server."], recordCount: 0 };
      }
    },
    exportSnapshot: async (client, departmentId) => {
      const snapshot = await loadRows(client, departmentId);
      const count = snapshot.flows.length + snapshot.steps.length + snapshot.enrollments.length + snapshot.progress.length + snapshot.audit.length;
      if (count > maxRows || Buffer.byteLength(JSON.stringify(snapshot)) > maxSnapshotBytes) throw new Error("People Flow records exceed the supported replication snapshot limit.");
      return snapshot;
    },
    restoreSnapshot: async (client, departmentId, input, restoreContext) => {
      const snapshot = readSnapshot(input);
      for (const enrollment of snapshot.enrollments) {
        if (typeof enrollment.contact_id !== "string") throw new Error("The People Flows snapshot contains an assignment without a person ID.");
        const contact = await client.query("SELECT 1 FROM contacts WHERE department_id=$1 AND id=$2", [departmentId, enrollment.contact_id]);
        if (!contact.rowCount) throw new Error("Restore People data before restoring People Flows; a referenced person is missing.");
      }
      // Each site snapshot replaces the full module-owned dataset. Delete
      // dependent rows first so later updates can be applied safely too.
      for (const descriptor of [...tables].reverse()) {
        await client.query(`DELETE FROM ${descriptor.table} WHERE department_id=$1`, [departmentId]);
      }
      let recordCount = 0;
      for (const descriptor of tables) {
        const rows = snapshot[descriptor.key] as Row[];
        const placeholders = descriptor.columns.map((_, index) => `$${index + 1}`).join(",");
        const sql = `INSERT INTO ${descriptor.table}(${descriptor.columns.join(",")}) VALUES(${placeholders})`;
        for (const source of rows) {
          const row = remapRow(source, restoreContext.userIdMap, departmentId);
          await client.query(sql, descriptor.columns.map((column) => row[column]));
          recordCount += 1;
        }
      }
      return { recordCount };
    },
    verifySnapshot: async (client, departmentId, input, restoreContext) => {
      if (input === undefined) return { ready: true, blockers: [] };
      let snapshot: Snapshot;
      try { snapshot = readSnapshot(input); }
      catch (error) { return { ready: false, blockers: [error instanceof Error ? error.message : "The People Flows snapshot is invalid."] }; }
      for (const descriptor of tables) {
        const expected = (snapshot[descriptor.key] as Row[]).map((row) => canonical(remapRow(row, restoreContext?.userIdMap ?? new Map(), departmentId))).sort();
        const actualRows = await client.query(`SELECT ${descriptor.columns.join(",")} FROM ${descriptor.table} WHERE department_id=$1 ORDER BY ${descriptor.order}`, [departmentId]);
        const actual = actualRows.rows.map((row) => canonical(row as Row)).sort();
        if (expected.length !== actual.length || expected.some((row, index) => row !== actual[index])) {
          return { ready: false, blockers: [`People Flow ${descriptor.key} records differ from the source snapshot after restore.`] };
        }
      }
      return { ready: true, blockers: [] };
    },
  });
}
