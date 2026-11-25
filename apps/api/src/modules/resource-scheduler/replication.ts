import type { PoolClient } from "pg";
import { collectCalendarBookingEvidence, requireCalendarBookingModules, validateCalendarBookingSnapshots } from "../../calendar-booking-replication.js";
import type { ModuleServerContext, ReplicationExportContext, ReplicationRestoreContext } from "../module-sdk.js";

const tables = {
  settings: { name: "resource_scheduler_settings", columns: "resource_id total_units default_lead_in_minutes default_cleanup_minutes updated_at", key: "resource_id" },
  series: { name: "resource_booking_series", columns: "id resource_id requested_by purpose starts_at ends_at recurrence quantity lead_in_minutes cleanup_minutes initial_status linked_appointment_id archived_at created_at updated_at time_zone all_day_date subtitle description beneficiary_contact_id requester_actor_id requester_actor_name", key: "id" },
  occurrences: { name: "resource_booking_series_occurrences", columns: "id series_id resource_booking_id occurrence_starts_at is_extra_date", key: "id" },
  dates: { name: "resource_booking_series_dates", columns: "series_id occurrence_date date_type created_by created_at creator_actor_id creator_actor_name", key: "series_id,occurrence_date,date_type", child: true },
  overrides: { name: "resource_booking_series_occurrence_overrides", columns: "series_id occurrence_date resource_booking_id updated_by all_day created_at updated_at editor_actor_id editor_actor_name", key: "series_id,occurrence_date", child: true },
  marks: { name: "resource_scheduler_marks", columns: "user_id resource_id", key: "user_id,resource_id" },
  audit: { name: "resource_scheduler_audit", columns: "id actor_user_id action series_id booking_id details created_at historical_actor_id historical_actor_name", key: "id" },
  subscriptions: { name: "resource_booking_calendar_subscriptions", columns: "user_id token_hash", key: "user_id" },
} satisfies Record<string, { name: string; columns: string; key: string; child?: boolean }>;
type Table = keyof typeof tables;
type Row = Record<string, unknown>;
type Snapshot = { version: 1; calendarBookingEvidence?: string } & Record<Table, Row[]>;
const keys = Object.keys(tables) as Table[];
const dateColumns = new Set(["all_day_date", "occurrence_date"]);
const jsonColumns = new Set(["recurrence", "details"]);
const userColumns = new Set(["requested_by", "created_by", "updated_by", "actor_user_id", "user_id"]);
const tokenHash = /^[0-9a-f]{64}$/;
const orphanMarkBlocker = "Resource Scheduler has saved marks for accounts that are no longer members of this location.";

function record(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readSnapshot(input: unknown): Snapshot {
  if (!record(input) || input.version !== 1) throw new Error("The Resource Scheduler snapshot is invalid.");
  for (const key of keys) {
    const columns = tables[key].columns.split(" ");
    const rows = input[key];
    if (!Array.isArray(rows) || !rows.every((row) => record(row) &&
      Object.keys(row).length === columns.length && columns.every((column) => Object.hasOwn(row, column)))) {
      throw new Error(`Resource Scheduler snapshot rows for ${key} are invalid.`);
    }
  }
  return input as Snapshot;
}

async function linkBlocker(client: Pick<PoolClient, "query">, departmentId: string, replication?: ReplicationExportContext) {
  try {
    requireCalendarBookingModules(await collectCalendarBookingEvidence(client, departmentId), replication);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The Calendar booking links could not be verified.";
  }
}

async function blockers(client: Pick<PoolClient, "query">, departmentId: string, replication?: ReplicationExportContext) {
  const state = await client.query<{ orphan_mark: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM resource_scheduler_marks mark WHERE mark.department_id=$1
      AND NOT EXISTS (SELECT 1 FROM department_memberships member WHERE member.department_id=$1 AND member.user_id=mark.user_id)
  ) AS orphan_mark`, [departmentId]);
  return [await linkBlocker(client, departmentId, replication),
    state.rows[0]?.orphan_mark ? orphanMarkBlocker : null].filter((value): value is string => !!value);
}

function assertDependencies(snapshot: Snapshot, core: unknown) {
  if (!record(core) || !record(core.tables)) throw new Error("Resource Scheduler standby requires a corresponding Core snapshot.");
  const rows = (name: string) => {
    const value = (core.tables as Row)[name];
    return Array.isArray(value) ? value.filter(record) : [];
  };
  const resources = new Set(rows("bookable_resources").map((row) => row.id));
  const bookings = new Set(rows("resource_bookings").map((row) => row.id));
  const contacts = new Set(rows("contacts").map((row) => row.id));
  const members = new Set(rows("department_memberships").map((row) => row.user_id));
  const series = new Set(snapshot.series.map((row) => row.id));
  const occurrences = new Set(snapshot.occurrences.map((row) => `${row.series_id}:${row.resource_booking_id}`));
  if ([...snapshot.settings, ...snapshot.series, ...snapshot.marks].some((row) => !resources.has(row.resource_id)) ||
      snapshot.series.some((row) => row.beneficiary_contact_id !== null && !contacts.has(row.beneficiary_contact_id)) ||
      snapshot.occurrences.some((row) => !series.has(row.series_id) || !bookings.has(row.resource_booking_id)) ||
      snapshot.dates.some((row) => !series.has(row.series_id)) ||
      snapshot.overrides.some((row) => !occurrences.has(`${row.series_id}:${row.resource_booking_id}`))) {
    throw new Error("Resource Scheduler records reference missing resources, contacts, series or booking occurrences.");
  }
  if ([...snapshot.marks, ...snapshot.subscriptions].some((row) => !members.has(row.user_id))) {
    throw new Error("Resource Scheduler marks or subscriptions reference an account outside the Core location membership.");
  }
  if (snapshot.subscriptions.some((row) => typeof row.token_hash !== "string" || !tokenHash.test(row.token_hash))) {
    throw new Error("A Resource Scheduler subscription hash is invalid.");
  }
}

async function collect(client: Pick<PoolClient, "query">, departmentId: string): Promise<Snapshot> {
  const snapshot: Snapshot = { version: 1, settings: [], series: [], occurrences: [], dates: [], overrides: [], marks: [], audit: [], subscriptions: [] };
  for (const key of keys) {
    const table = tables[key];
    const columns = table.columns.split(" ").map((column) => dateColumns.has(column)
      ? `to_char(item.${column},'YYYY-MM-DD') AS ${column}` : `item.${column}`).join(",");
    const scope = "child" in table
      ? "JOIN resource_booking_series series ON series.id=item.series_id WHERE series.department_id=$1"
      : "WHERE item.department_id=$1";
    const order = table.key.split(",").map((column) => `item.${column}`).join(",");
    snapshot[key] = (await client.query(`SELECT ${columns} FROM ${table.name} item ${scope} ORDER BY ${order}`, [departmentId])).rows;
  }
  return snapshot;
}

function mappedRow(row: Row, context: ReplicationRestoreContext) {
  return Object.fromEntries(Object.entries(row).map(([column, value]) => [
    column, userColumns.has(column) && value != null ? context.userIdMap.get(String(value)) ?? null : value,
  ]));
}

async function insert(client: PoolClient, departmentId: string, key: Table, rows: Row[], context: ReplicationRestoreContext) {
  const table = tables[key];
  const columns = table.columns.split(" ");
  if (!("child" in table)) columns.unshift("department_id");
  const sql = `INSERT INTO ${table.name}(${columns.join(",")}) VALUES(${columns.map((_, index) => "$" + (index + 1)).join(",")})`;
  for (const source of rows) {
    const row = { ...mappedRow(source, context), department_id: departmentId };
    const result = await client.query(sql, columns.map((column) => {
      const value = (row as Row)[column];
      return jsonColumns.has(column) && value != null ? JSON.stringify(value) : value;
    }));
    if (result.rowCount !== 1) throw new Error("A Resource Scheduler snapshot record could not be restored.");
  }
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function registerResourceSchedulerReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  const count = async (db: Pick<PoolClient, "query">, departmentId: string) => {
    const totals = await db.query<{ count: number }>(`SELECT sum(record_count)::int AS count FROM (
      ${keys.map((key) => {
        const table = tables[key];
        const scope = "child" in table ? "JOIN resource_booking_series series ON series.id=item.series_id WHERE series.department_id=$1" : "WHERE item.department_id=$1";
        return `SELECT count(*) AS record_count FROM ${table.name} item ${scope}`;
      }).join(" UNION ALL ")}
    ) counts`, [departmentId]);
    return totals.rows[0].count;
  };
  context.replication.register({
    schemaVersion: "2",
    async requiresSnapshot(departmentId) {
      if (!pool || !isDatabaseReady()) return false;
      return Boolean(await count(pool, departmentId) || (await blockers(pool, departmentId)).length);
    },
    async inspect(departmentId, replication) {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["The Resource Scheduler database is unavailable."], recordCount: 0 };
      const problems = await blockers(pool, departmentId, replication);
      return { ready: problems.length === 0, blockers: problems, recordCount: await count(pool, departmentId) };
    },
    async exportSnapshot(client, departmentId, replication) {
      const problems = await blockers(client, departmentId, replication);
      if (problems.length) throw new Error(problems.join(" "));
      const snapshot = await collect(client, departmentId);
      const evidence = await collectCalendarBookingEvidence(client, departmentId);
      return evidence ? { ...snapshot, calendarBookingEvidence: evidence } : snapshot;
    },
    prepareSnapshotForPeer: async (input, seal) => {
      const snapshot = readSnapshot(input);
      return { ...snapshot, subscriptions: snapshot.subscriptions.map((row) => ({ ...row, token_hash: { sealed: seal(String(row.token_hash)) } })) };
    },
    restoreSnapshotFromPeer: async (input, open) => {
      const snapshot = readSnapshot(input);
      return { ...snapshot, subscriptions: snapshot.subscriptions.map((row) => {
        if (!record(row.token_hash) || typeof row.token_hash.sealed !== "string") throw new Error("A Resource Scheduler subscription was not protected for this standby.");
        const hash = open(row.token_hash.sealed);
        if (!tokenHash.test(hash)) throw new Error("A Resource Scheduler subscription hash is invalid.");
        return { ...row, token_hash: hash };
      }) };
    },
    restoreDependencies: {
      moduleIds: ["core-site", "church-calendar"],
      validate(input, dependencies) {
        const core = dependencies.get("core-site");
        assertDependencies(readSnapshot(input), core);
        validateCalendarBookingSnapshots(dependencies.get("church-calendar"), input, core);
      },
    },
    async validateRestoreTarget(client, departmentId, input, replication) {
      const problems = await blockers(client, departmentId, replication);
      const blocker = problems.find((problem) => problem !== orphanMarkBlocker);
      if (blocker) throw new Error(blocker);
      if (input === undefined) {
        if (await count(client, departmentId)) throw new Error("The incoming standby snapshot omits existing Resource Scheduler data.");
        return;
      }
    },
    async prepareRestore(client, departmentId, input) {
      if (input === undefined) return;
      for (const key of ["series", "settings", "marks", "audit", "subscriptions"] as const) {
        await client.query(`DELETE FROM ${tables[key].name} WHERE department_id=$1`, [departmentId]);
      }
    },
    async restoreBeforeCoreResourceBookings(client, departmentId, input, restoreContext) {
      await insert(client, departmentId, "settings", readSnapshot(input).settings, restoreContext);
    },
    async restoreSnapshot(client, departmentId, input, restoreContext) {
      const snapshot = readSnapshot(input);
      for (const key of keys) if (key !== "settings") await insert(client, departmentId, key, snapshot[key], restoreContext);
      return { recordCount: keys.reduce((sum, key) => sum + snapshot[key].length, 0) };
    },
    async verifySnapshot(client, departmentId, input, restoreContext) {
      const snapshot = readSnapshot(input);
      const actual = await collect(client, departmentId);
      if (snapshot.calendarBookingEvidence !== await collectCalendarBookingEvidence(client, departmentId)) {
        return { ready: false, blockers: ["Restored Calendar and Scheduler booking links differ from the signed snapshot."] };
      }
      for (const key of keys) {
        const rows = restoreContext ? snapshot[key].map((row) => mappedRow(row, restoreContext)) : snapshot[key];
        const signature = (items: Row[]) => items.map((row) => JSON.stringify(canonical(row))).sort();
        if (JSON.stringify(signature(rows)) !== JSON.stringify(signature(actual[key]))) {
          return { ready: false, blockers: [`Resource Scheduler ${key} differs from the signed snapshot.`] };
        }
      }
      return { ready: true, blockers: [] };
    },
  });
}
