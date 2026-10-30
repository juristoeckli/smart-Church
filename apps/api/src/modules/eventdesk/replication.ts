import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";
import type { ModuleServerContext, ReplicationRestoreContext } from "../module-sdk.js";

const maxSnapshotBytes = 200 * 1024 * 1024;
type Column = { column_table: string; column_name: string; data_type: string; ordinal_position: number };
type Table = { name: string; columns: Column[]; binaryColumns: string[] };
type SnapshotTable = { name: string; columns: string[]; binaryColumns: string[]; rows: Array<Record<string, unknown>> };
type EventDeskSnapshot = { version: 1; tables: SnapshotTable[] };

function q(identifier: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) throw new Error("EventDesk returned an unsafe table or column name.");
  return "\"" + identifier + "\"";
}

async function discoverTables(client: Pick<PoolClient, "query">): Promise<Table[]> {
  const result = await client.query<Column>("SELECT table_name AS column_table,column_name,data_type,ordinal_position FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'eventdesk\\_%' ESCAPE '\\' ORDER BY table_name,ordinal_position");
  const byName = new Map<string, Column[]>();
  for (const row of result.rows) {
    const columns = byName.get(row.column_table) ?? [];
    columns.push(row);
    byName.set(row.column_table, columns);
  }
  return [...byName].map(([name, columns]) => ({ name, columns, binaryColumns: columns.filter((column) => column.data_type === "bytea").map((column) => column.column_name) }));
}

async function tableOrder(client: Pick<PoolClient, "query">, tables: Table[]) {
  const names = new Set(tables.map((table) => table.name));
  const constraints = await client.query<{ child: string; parent: string }>("SELECT child.relname AS child,parent.relname AS parent FROM pg_constraint constraint_row JOIN pg_class child ON child.oid=constraint_row.conrelid JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace JOIN pg_class parent ON parent.oid=constraint_row.confrelid WHERE constraint_row.contype='f' AND child_ns.nspname='public'");
  const parents = new Map<string, Set<string>>([...names].map((name) => [name, new Set<string>()]));
  for (const row of constraints.rows) if (names.has(row.child) && names.has(row.parent) && row.child !== row.parent) parents.get(row.child)!.add(row.parent);
  const ordered: string[] = [];
  const pending = new Set(names);
  while (pending.size) {
    const ready = [...pending].filter((name) => [...parents.get(name)!].every((parent) => !pending.has(parent))).sort();
    if (!ready.length) throw new Error("EventDesk has a cyclic table dependency; safe snapshot restore is unavailable.");
    for (const name of ready) { ordered.push(name); pending.delete(name); }
  }
  return ordered;
}

async function inspectTables(client: Pick<PoolClient, "query">, departmentId: string) {
  const tables = await discoverTables(client);
  const unscoped = tables.filter((table) => !table.columns.some((column) => column.column_name === "department_id"));
  let records = 0;
  let bytes = 0;
  for (const table of tables) {
    if (unscoped.some((item) => item.name === table.name)) continue;
    const result = await client.query<{ count: string; bytes: string }>("SELECT count(*)::text AS count,COALESCE(sum(pg_column_size(row_data)),0)::text AS bytes FROM (SELECT t AS row_data FROM " + q(table.name) + " t WHERE department_id=$1) scoped", [departmentId]);
    records += Number(result.rows[0].count);
    bytes += Number(result.rows[0].bytes);
  }
  const blockers = unscoped.length ? ["Location scope is missing on EventDesk tables: " + unscoped.map((table) => table.name).join(", ") + "."] : [];
  if (!tables.length) blockers.push("EventDesk storage has not been initialized.");
  if (bytes > maxSnapshotBytes) blockers.push("EventDesk records and attachments exceed the 200 MiB snapshot limit.");
  return { tables, records, bytes, blockers };
}

async function collect(client: PoolClient, departmentId: string): Promise<EventDeskSnapshot> {
  const inspection = await inspectTables(client, departmentId);
  if (inspection.blockers.length) throw new Error(inspection.blockers.join(" "));
  const order = await tableOrder(client, inspection.tables);
  const byName = new Map(inspection.tables.map((table) => [table.name, table]));
  const tables: SnapshotTable[] = [];
  for (const name of order) {
    const table = byName.get(name)!;
    const columns = table.columns.map((column) => column.column_name);
    const selection = columns.map((column) => table.binaryColumns.includes(column) ? "encode(" + q(column) + ",'base64') AS " + q(column) : q(column));
    const rows = await client.query("SELECT " + selection.join(",") + " FROM " + q(name) + " WHERE department_id=$1", [departmentId]);
    const orderedRows = rows.rows as Array<Record<string, unknown>>;
    orderedRows.sort((left, right) => canonical(left).localeCompare(canonical(right)));
    tables.push({ name, columns, binaryColumns: table.binaryColumns, rows: orderedRows });
  }
  return { version: 1, tables };
}

function mapUserRefs(row: Record<string, unknown>, mapping: Map<string, string>) {
  for (const [key, value] of Object.entries(row)) if (typeof value === "string" && (key === "user_id" || key.endsWith("_user_id") || key.endsWith("_by"))) row[key] = mapping.get(value) ?? value;
  return row;
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString("base64"));
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}

export function registerEventDeskReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  context.replication.register({
    schemaVersion: "2",
    getSchemaVersion: async () => {
      const apiKey = process.env.SMART_CHURCH_RESEND_API_KEY?.trim() || process.env.RESEND_API_KEY?.trim() || "";
      const emailFrom = process.env.SMART_CHURCH_EMAIL_FROM?.trim() || process.env.EVENTDESK_EMAIL_FROM?.trim() || "";
      const externalMailConfig = apiKey && emailFrom
        ? createHmac("sha256", apiKey).update(`smart-church/eventdesk/resend/v1:${emailFrom}`).digest("hex")
        : !apiKey && !emailFrom ? "unconfigured" : "incomplete";
      return `2:${externalMailConfig}`;
    },
    inspect: async (departmentId) => {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["EventDesk database is unavailable."], recordCount: 0 };
      try {
        const client = await pool.connect();
        try {
          await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
          const result = await inspectTables(client, departmentId);
          await client.query("COMMIT");
          return { ready: result.blockers.length === 0, blockers: result.blockers, recordCount: result.records };
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      } catch (error) { return { ready: false, blockers: [error instanceof Error ? error.message.slice(0, 300) : "EventDesk inspection failed."], recordCount: 0 }; }
    },
    exportSnapshot: (client, departmentId) => collect(client, departmentId),
    restoreSnapshot: async (client, departmentId, input, context: ReplicationRestoreContext) => {
      const snapshot = input as EventDeskSnapshot;
      if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.tables) || snapshot.tables.length > 500) throw new Error("The EventDesk snapshot is invalid or unsupported.");
      const localTables = await discoverTables(client);
      const local = new Map(localTables.map((table) => [table.name, table]));
      const incoming = new Map(snapshot.tables.map((table) => [table.name, table]));
      if (incoming.size !== snapshot.tables.length || incoming.size !== local.size || localTables.some((table) => !incoming.has(table.name))) throw new Error("The primary and standby have different EventDesk table sets.");
      for (const table of snapshot.tables) {
        const actual = local.get(table.name)!;
        if (JSON.stringify(table.columns) !== JSON.stringify(actual.columns.map((column) => column.column_name)) || JSON.stringify(table.binaryColumns) !== JSON.stringify(actual.binaryColumns)) throw new Error("The EventDesk schema differs for " + table.name + ".");
      }
      const order = await tableOrder(client, localTables);
      for (const name of [...order].reverse()) await client.query("DELETE FROM " + q(name) + " WHERE department_id=$1", [departmentId]);
      let recordCount = 0;
      for (const name of order) {
        const table = incoming.get(name)!;
        for (const sourceRow of table.rows) {
          const row = mapUserRefs({ ...sourceRow, department_id: departmentId }, context.userIdMap);
          for (const binaryColumn of table.binaryColumns) if (typeof row[binaryColumn] === "string") row[binaryColumn] = Buffer.from(row[binaryColumn] as string, "base64");
          await client.query("INSERT INTO " + q(name) + " (" + table.columns.map(q).join(",") + ") VALUES (" + table.columns.map((_, index) => "$" + (index + 1)).join(",") + ")", table.columns.map((column) => {
            const value = row[column.column_name];
            if (value === null || value === undefined) return null;
            return column.data_type === "json" || column.data_type === "jsonb" ? JSON.stringify(value) : value;
          }));
          recordCount += 1;
        }
      }
      return { recordCount };
    },
    verifySnapshot: async (client, departmentId, input, context) => {
      const snapshot = input as EventDeskSnapshot;
      if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.tables)) return { ready: false, blockers: ["No supported EventDesk snapshot is available."] };
      const actual = await collect(client, departmentId);
      const expected = new Map(snapshot.tables.map((table) => [table.name, table]));
      const mapping = context?.userIdMap ?? new Map<string, string>();
      for (const actualTable of actual.tables) {
        const expectedTable = expected.get(actualTable.name);
        if (!expectedTable || expectedTable.rows.length !== actualTable.rows.length) return { ready: false, blockers: ["EventDesk row count verification failed for " + actualTable.name + "."] };
        for (let index = 0; index < actualTable.rows.length; index += 1) {
          const expectedRow = mapUserRefs({ ...expectedTable.rows[index], department_id: departmentId }, mapping);
          if (canonical(expectedRow) !== canonical(actualTable.rows[index])) return { ready: false, blockers: ["EventDesk data verification failed for " + actualTable.name + "."] };
        }
      }
      return { ready: actual.tables.length === snapshot.tables.length, blockers: actual.tables.length === snapshot.tables.length ? [] : ["The EventDesk table inventory changed during verification."] };
    },
  });
}
