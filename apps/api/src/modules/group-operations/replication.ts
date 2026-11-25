import type { Pool, PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type Row = Record<string, unknown>;
type Snapshot = { version: 4; tables: Record<string, Row[]> };
const maxRows = 250_000;
const maxBytes = 50 * 1024 * 1024;
const batchSize = 500;
const tables = [
  {
    name: "group_routine_definitions",
    columns: "id department_id group_id name description cadence active created_by updated_at",
    users: ["created_by"], contacts: [],
  },
  {
    name: "group_routine_runs",
    columns: "id department_id routine_id run_date status assigned_contact_id notes created_by completed_by completed_at created_at",
    users: ["created_by", "completed_by"], contacts: ["assigned_contact_id"],
  },
  {
    name: "group_certificate_definitions",
    columns: "id department_id group_id name description active created_by created_at document_text",
    users: ["created_by"], contacts: [],
  },
  {
    name: "group_certificate_issues",
    columns: "id department_id certificate_id group_id contact_id issued_at valid_until notes issued_by revoked_at revoked_by revoke_reason created_at",
    users: ["issued_by", "revoked_by"], contacts: ["contact_id"],
  },
  {
    name: "group_membership_rule_sets",
    columns: "id department_id group_id name contact_status enabled created_by updated_at",
    users: ["created_by"], contacts: [],
  },
  {
    name: "group_follow_up_tasks",
    columns: "id department_id group_id contact_id assigned_contact_id subject note due_date status created_by completed_by completed_at created_at updated_at",
    users: ["created_by", "completed_by"], contacts: ["contact_id", "assigned_contact_id"],
  },
  {
    name: "group_meeting_feedback_templates",
    columns: "id department_id group_id title questions created_by updated_by updated_at anonymous_attendee_responses",
    users: ["created_by", "updated_by"], contacts: [],
  },
  {
    name: "group_meeting_feedback_responses",
    columns: "id department_id group_id meeting_id answers created_by updated_by created_at updated_at meeting_comment guest_count",
    users: ["created_by", "updated_by"], contacts: [],
  },
  {
    name: "group_meeting_feedback_attendee_submissions",
    columns: "id department_id group_id meeting_id contact_id answers created_by updated_by created_at updated_at anonymous_response_token_hash",
    users: ["created_by", "updated_by"], contacts: ["contact_id"],
  },
  {
    name: "group_operations_audit",
    columns: "id department_id group_id actor_user_id action record_id details created_at",
    users: ["actor_user_id"], contacts: [],
  },
  {
    name: "group_automatic_routines",
    columns: "id department_id group_id name trigger_role trigger_status steps enabled created_by authorized_by created_at updated_at",
    users: ["created_by", "authorized_by"], contacts: [],
  },
  {
    name: "group_automatic_routine_runs",
    columns: "id department_id group_id routine_id contact_id phase next_step due_at chain outcome created_at updated_at",
    users: [], contacts: ["contact_id"],
  },
].map((table) => ({ ...table, columns: table.columns.split(" ") }));

type Table = typeof tables[number];

function record(value: unknown): value is Row {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function checkedSnapshot(input: unknown): Snapshot {
  if (!record(input) || (input.version !== 3 && input.version !== 4) || !record(input.tables)) {
    throw new Error("The Group Operations snapshot has an unsupported format.");
  }
  if (input.version === 3 && Object.keys(input.tables).length !== tables.length - 2) throw new Error("The Group Operations snapshot has an unsupported format.");
  const data = input.version === 3 ? { group_automatic_routines: [], group_automatic_routine_runs: [], ...input.tables } : input.tables;
  if (Object.keys(data).length !== tables.length) throw new Error("The Group Operations snapshot has an unsupported format.");
  let count = 0;
  for (const table of tables) {
    const rows = data[table.name];
    if (!Array.isArray(rows) || rows.some((row: unknown) => !record(row) || typeof row.id !== "string" ||
      table.columns.some((column) => !Object.hasOwn(row, column)) || Object.keys(row).length !== table.columns.length)) {
      throw new Error("The Group Operations snapshot contains invalid rows.");
    }
    count += rows.length;
  }
  if (count > maxRows || Buffer.byteLength(JSON.stringify(input)) > maxBytes) {
    throw new Error("The Group Operations snapshot exceeds the supported size.");
  }
  return { version: 4, tables: data as Snapshot["tables"] };
}

async function selectRows(client: PoolClient, table: Table, departmentId: string) {
  const timestamps = new Set(["created_at", "updated_at", "completed_at", "revoked_at", "due_at"]);
  const projectedColumns = table.columns.map((column) => timestamps.has(column)
    ? `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ${column}`
    : column).join(",");
  // JSON date/time rendering keeps calendar dates independent of the Node process time zone.
  return (await client.query<{ data: Row }>(
    `SELECT to_jsonb(snapshot_row) AS data FROM (
       SELECT ${projectedColumns} FROM ${table.name} WHERE department_id=$1 ORDER BY id
     ) snapshot_row`,
    [departmentId],
  )).rows.map(({ data }) => data);
}

async function hasRows(client: PoolClient, departmentId: string) {
  for (const table of tables) {
    const found = await client.query(`SELECT 1 FROM ${table.name} WHERE department_id=$1 LIMIT 1`, [departmentId]);
    if (found.rowCount) return true;
  }
  return false;
}

async function inspectStorage(pool: Pool, departmentId: string) {
  let recordCount = 0;
  let bytes = 0;
  for (const table of tables) {
    const result = await pool.query<{ rows: string; bytes: string }>(
      `SELECT count(*)::text AS rows,coalesce(sum(pg_column_size(to_jsonb(row_data))),0)::text AS bytes
         FROM ${table.name} row_data WHERE department_id=$1`,
      [departmentId],
    );
    recordCount += Number(result.rows[0].rows);
    bytes += Number(result.rows[0].bytes);
  }
  return { recordCount, bytes };
}

function mapRow(source: Row, table: Table, departmentId: string, userIdMap: Map<string, string>): Row {
  const row: Row = { ...source, department_id: departmentId };
  for (const column of table.users) {
    const id = row[column];
    // Some historical actors no longer belong to the source site, so core does not snapshot those accounts.
    row[column] = typeof id === "string" ? userIdMap.get(id) ?? null : null;
  }
  return row;
}

async function checkReferences(client: PoolClient, table: Table, departmentId: string) {
  const references = [
    ...(table.columns.includes("group_id") ? [{ column: "group_id", parent: "church_groups" }] : []),
    ...table.contacts.map((column) => ({ column, parent: "contacts" })),
  ];
  for (const { column, parent } of references) {
    const invalid = await client.query(
      `SELECT 1 FROM ${table.name} child
        WHERE child.department_id=$1 AND child.${column} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ${parent} parent WHERE parent.id=child.${column} AND parent.department_id=$1)
        LIMIT 1`,
      [departmentId],
    );
    if (invalid.rowCount) throw new Error("A Group Operations record refers to a group or person outside the restored location.");
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (record(value)) return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}

export function registerGroupOperationsReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  context.replication.register({
    schemaVersion: "4",
    async inspect(departmentId) {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["The Group Operations database is unavailable."], recordCount: 0 };
      try {
        const { recordCount, bytes } = await inspectStorage(pool, departmentId);
        const ready = recordCount <= maxRows && bytes <= maxBytes;
        return { ready, blockers: ready ? [] : ["Group Operations data exceeds the replication snapshot limit."], recordCount };
      } catch {
        return { ready: false, blockers: ["Group Operations replication storage is unavailable."], recordCount: 0 };
      }
    },
    async exportSnapshot(client, departmentId) {
      const snapshot: Snapshot = { version: 4, tables: {} };
      for (const table of tables) snapshot.tables[table.name] = await selectRows(client, table, departmentId);
      checkedSnapshot(snapshot);
      return snapshot;
    },
    async prepareRestore(client, departmentId, input) {
      if (input === undefined) {
        if (await hasRows(client, departmentId)) throw new Error("The source snapshot omits Group Operations data for a standby that already has Group Operations records.");
        return;
      }
      checkedSnapshot(input);
      // Certificates and follow-ups may restrict deletion of core groups or contacts.
      for (const table of [...tables].reverse()) await client.query(`DELETE FROM ${table.name} WHERE department_id=$1`, [departmentId]);
    },
    async restoreSnapshot(client, departmentId, input, { userIdMap }) {
      const snapshot = checkedSnapshot(input);
      let recordCount = 0;
      for (const table of tables) {
        const rows = snapshot.tables[table.name];
        const columns = table.columns.join(",");
        for (let first = 0; first < rows.length; first += batchSize) {
          const batch = rows.slice(first, first + batchSize).map((row) => mapRow(row, table, departmentId, userIdMap));
          await client.query(
            `INSERT INTO ${table.name} (${columns})
             SELECT ${columns} FROM jsonb_populate_recordset(NULL::${table.name},$1::jsonb)`,
            [JSON.stringify(batch)],
          );
        }
        if (rows.length) await checkReferences(client, table, departmentId);
        recordCount += rows.length;
      }
      return { recordCount };
    },
    async verifySnapshot(client, departmentId, input, restoreContext) {
      if (input === undefined) return { ready: true, blockers: [] };
      const snapshot = checkedSnapshot(input);
      const userIdMap = restoreContext?.userIdMap ?? new Map<string, string>();
      for (const table of tables) {
        const expected = snapshot.tables[table.name].map((row) => canonical(mapRow(row, table, departmentId, userIdMap))).sort();
        const actual = (await selectRows(client, table, departmentId)).map(canonical).sort();
        if (actual.length !== expected.length || expected.some((row, index) => row !== actual[index])) {
          return { ready: false, blockers: ["Group Operations records differ from the source snapshot after restore."] };
        }
      }
      return { ready: true, blockers: [] };
    },
  });
}
