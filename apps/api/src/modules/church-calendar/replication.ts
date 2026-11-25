import { normalizeCalendarImageMetadata } from "./image-metadata.js";
import type { PoolClient } from "pg";
import { collectCalendarBookingEvidence, requireCalendarBookingModules, validateCalendarBookingSnapshots } from "../../calendar-booking-replication.js";
import type { ModuleServerContext, ReplicationExportContext, ReplicationRestoreContext } from "../module-sdk.js";

const tables = {
  calendars: { name: "church_calendar_calendars", key: "id", columns: "id name scope group_id owner_user_id color created_by created_at updated_at archived_at sort_order allow_member_appointments default_service_plan_template_id historical_actor_id historical_actor_name" },
  appointments: { name: "church_calendar_appointments", key: "id", columns: "id calendar_id title subtitle description starts_at ends_at all_day place url internal_only tags recurrence linked_event_id signup_group_id responsible_contact_id time_zone created_by created_at updated_at archived_at historical_actor_id historical_actor_name" },
  exceptions: { name: "church_calendar_appointment_exceptions", key: "appointment_id,original_start", columns: "appointment_id original_start cancelled overrides updated_by updated_at historical_actor_id historical_actor_name", child: true },
  signupSchedules: { name: "church_calendar_signup_schedules", key: "appointment_id", columns: "appointment_id lead_days template_group_id created_by auto_publish", child: true },
  dates: { name: "church_calendar_extra_dates", key: "appointment_id,starts_at", columns: "appointment_id starts_at ends_at created_by historical_actor_id historical_actor_name", child: true },
  images: { name: "church_calendar_appointment_images", key: "appointment_id", columns: "appointment_id content_type filename content uploaded_by updated_at historical_actor_id historical_actor_name image_metadata revision" },
  templates: { name: "church_calendar_appointment_templates", key: "id", columns: "id calendar_id name title subtitle description place url internal_only tags" },
  generations: { name: "church_calendar_event_generations", key: "id", columns: "id appointment_id occurrence_start service_event_id template_id actor_user_id created_at historical_actor_id historical_actor_name" },
  tags: { name: "church_calendar_tag_definitions", key: "tag_key", columns: "tag_key name color description" },
  feeds: { name: "church_calendar_public_feeds", key: "calendar_id", columns: "calendar_id token_hash created_by created_at revoked_at historical_actor_id historical_actor_name" },
  agendaPublications: { name: "church_calendar_agenda_publications", key: "id", columns: "id name token_hash created_by created_at revoked_at historical_actor_id historical_actor_name" },
  agendaCalendars: { name: "church_calendar_agenda_calendars", key: "publication_id,position", columns: "publication_id calendar_id position" },
  subscriptions: { name: "church_calendar_subscriptions", key: "calendar_id,user_id", columns: "calendar_id user_id token_hash" },
  bookingLinks: { name: "church_calendar_resource_links", key: "appointment_id,resource_booking_id", child: true, columns: "appointment_id resource_booking_id occurrence_start created_by historical_actor_id historical_actor_name" },
  emailSubscriptions: { name: "church_calendar_email_subscriptions", key: "calendar_id,user_id", columns: "calendar_id user_id cadence checked_through next_check_at notice_id notice_since" },
  reminders: { name: "church_calendar_reminders", key: "id", columns: "id appointment_id user_id original_start minutes_before clock_time clock_time_zone next_check_at delivered_at" },
  meetingRequests: { name: "church_calendar_meeting_requests", key: "appointment_id,original_start,recipient_user_id", columns: "appointment_id original_start recipient_user_id notice_id invited_by scheduled_start scheduled_end status invited_at responded_at historical_actor_id historical_actor_name", child: true },
} satisfies Record<string, { name: string; columns: string; key: string; child?: boolean }>;
type Table = keyof typeof tables;
type Row = Record<string, unknown>;
type Snapshot = { version: 6; calendarBookingEvidence?: string } & Record<Table, Row[]>;
const keys = Object.keys(tables) as Table[];
const wallTimes = new Set(["starts_at", "ends_at", "original_start", "occurrence_start"]);
const tokenTables = ["feeds", "agendaPublications", "subscriptions"] as const;
const jsonColumns = new Set(["recurrence", "overrides", "image_metadata"]);
const userColumns = new Set(["owner_user_id", "created_by", "updated_by", "uploaded_by", "actor_user_id", "invited_by", "user_id", "recipient_user_id"]);
const tokenHash = /^[0-9a-f]{64}$/;
const scopeBlocker = "Calendar contains an appointment linked to a calendar in a different location.";
const memberBlocker = "Church Calendar has a personal calendar or meeting request for an account outside the location.";

function record(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readSnapshot(input: unknown): Snapshot {
  if (!record(input) || input.version !== 6) throw new Error("The Church Calendar snapshot is invalid.");
  for (const key of keys) {
    const columns = tables[key].columns.split(" ");
    const rows = input[key];
    if (!Array.isArray(rows) || !rows.every((row) => record(row) &&
      Object.keys(row).length === columns.length && columns.every((column) => Object.hasOwn(row, column)))) {
      throw new Error(`Church Calendar snapshot rows for ${key} are invalid.`);
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
  const state = await client.query<{ stale_member: boolean; invalid_scope: boolean }>(`SELECT
    EXISTS (SELECT 1 FROM church_calendar_calendars calendar WHERE calendar.department_id=$1 AND calendar.scope='personal'
      AND NOT EXISTS (SELECT 1 FROM department_memberships member WHERE member.department_id=$1 AND member.user_id=calendar.owner_user_id))
    OR EXISTS (SELECT 1 FROM church_calendar_meeting_requests request JOIN church_calendar_appointments appointment ON appointment.id=request.appointment_id
      WHERE appointment.department_id=$1
      AND NOT EXISTS (SELECT 1 FROM department_memberships member WHERE member.department_id=$1 AND member.user_id=request.recipient_user_id)) AS stale_member,
    EXISTS (SELECT 1 FROM church_calendar_appointments appointment JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id
      WHERE calendar.department_id<>appointment.department_id AND (calendar.department_id=$1 OR appointment.department_id=$1)) AS invalid_scope`, [departmentId]);
  const local = state.rows[0];
  return [await linkBlocker(client, departmentId, replication), local.stale_member ? memberBlocker : null,
    local.invalid_scope ? scopeBlocker : null].filter((value): value is string => !!value);
}

function assertDependencies(snapshot: Snapshot, core: unknown) {
  if (!record(core) || !record(core.tables)) throw new Error("Church Calendar standby requires a corresponding Core snapshot.");
  const ids = (name: string, key = "id") => {
    const value = (core.tables as Row)[name];
    return new Set(Array.isArray(value) ? value.filter(record).map((row) => row[key]) : []);
  };
  const groups = ids("church_groups"), people = ids("contacts"), events = ids("service_events"), serviceTemplates = ids("service_plan_templates");
  const members = ids("department_memberships", "user_id");
  const calendars = new Set(snapshot.calendars.map((row) => row.id));
  const appointments = new Set(snapshot.appointments.map((row) => row.id));
  const publications = new Set(snapshot.agendaPublications.map((row) => row.id));
  if ([...snapshot.calendars.filter((row) => row.scope === "personal").map((row) => row.owner_user_id),
    ...snapshot.meetingRequests.map((row) => row.recipient_user_id),
    ...snapshot.reminders.map((row) => row.user_id), ...snapshot.subscriptions.map((row) => row.user_id),
    ...snapshot.emailSubscriptions.map((row) => row.user_id),
  ].some((id) => !members.has(id))) throw new Error(memberBlocker);
  if (snapshot.calendars.some((row) => (row.group_id !== null && !groups.has(row.group_id)) ||
        (row.default_service_plan_template_id !== null && !serviceTemplates.has(row.default_service_plan_template_id))) ||
      [...snapshot.appointments, ...snapshot.templates, ...snapshot.feeds, ...snapshot.agendaCalendars, ...snapshot.subscriptions, ...snapshot.emailSubscriptions].some((row) => !calendars.has(row.calendar_id)) ||
      [...snapshot.exceptions, ...snapshot.signupSchedules, ...snapshot.dates, ...snapshot.images, ...snapshot.reminders, ...snapshot.meetingRequests].some((row) => !appointments.has(row.appointment_id)) ||
      snapshot.agendaCalendars.some((row) => !publications.has(row.publication_id))) {
    throw new Error("Church Calendar references missing calendars, appointments, group audiences, service templates or agenda publications.");
  }
  if (snapshot.signupSchedules.some((row) => !Number.isInteger(row.lead_days) || Number(row.lead_days) < 0
      || Number(row.lead_days) > 365 || typeof row.auto_publish !== "boolean" || (row.template_group_id !== null && !groups.has(row.template_group_id)))) {
    throw new Error("A Church Calendar signup schedule has an invalid lead time or references a template outside the Core location.");
  }
  const fields = [
    ["linked_event_id", "linkedEventId", events], ["signup_group_id", "signupGroupId", groups],
    ["responsible_contact_id", "responsibleContactId", people],
  ] as const;
  for (const [column, override, known] of fields) {
    if (snapshot.appointments.some((row) => row[column] !== null && !known.has(row[column])) ||
        snapshot.exceptions.some((row) => record(row.overrides) && row.overrides[override] != null && !known.has(row.overrides[override]))) {
      throw new Error("A Church Calendar appointment or exception references a record outside the Core location.");
    }
  }
  for (const key of tokenTables) if (snapshot[key].some((row) => typeof row.token_hash !== "string" || !tokenHash.test(row.token_hash))) {
    throw new Error("A Church Calendar feed or subscription hash is invalid.");
  }
  for (const image of snapshot.images) {
    if (!normalizeCalendarImageMetadata(image.image_metadata) || typeof image.revision !== "string"
      || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(image.revision)) {
      throw new Error("A Church Calendar image has invalid metadata or revision.");
    }
    const data = image.content;
    if (typeof data !== "string" || !data.length || data.length > Math.ceil(1048576 / 3) * 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("A Church Calendar image has invalid binary content.");
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > 1048576 || bytes.toString("base64") !== data) throw new Error("A Church Calendar image has invalid binary content.");
  }
}

async function collect(client: Pick<PoolClient, "query">, departmentId: string): Promise<Snapshot> {
  const snapshot = { version: 6 } as Snapshot;
  for (const key of keys) {
    const table = tables[key];
    const columns = table.columns.split(" ").map((column) => {
      if (wallTimes.has(column)) return `to_char(item.${column},'YYYY-MM-DD HH24:MI:SS.US') AS ${column}`;
      if (column === "content") return "replace(encode(item.content,'base64'),chr(10),'') AS content";
      return `item.${column}`;
    }).join(",");
    const scope = "child" in table
      ? "JOIN church_calendar_appointments appointment ON appointment.id=item.appointment_id WHERE appointment.department_id=$1"
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
      if (column === "content") return Buffer.from(String(value), "base64");
      return jsonColumns.has(column) && value != null ? JSON.stringify(value) : value;
    }));
    if (result.rowCount !== 1) throw new Error("A Church Calendar snapshot record could not be restored.");
  }
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function registerCalendarReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  const count = async (db: Pick<PoolClient, "query">, departmentId: string) => {
    const totals = await db.query<{ count: number }>(`SELECT sum(record_count)::int AS count FROM (
      ${keys.map((key) => {
        const table = tables[key];
        const scope = "child" in table ? "JOIN church_calendar_appointments appointment ON appointment.id=item.appointment_id WHERE appointment.department_id=$1" : "WHERE item.department_id=$1";
        return `SELECT count(*) AS record_count FROM ${table.name} item ${scope}`;
      }).join(" UNION ALL ")}
    ) counts`, [departmentId]);
    return totals.rows[0].count;
  };
  context.replication.register({
    schemaVersion: "6",
    async requiresSnapshot(departmentId) {
      if (!pool || !isDatabaseReady()) return false;
      return Boolean(await count(pool, departmentId) || (await blockers(pool, departmentId)).length);
    },
    async inspect(departmentId, replication) {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["The Church Calendar database is unavailable."], recordCount: 0 };
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
      return { ...snapshot, ...Object.fromEntries(tokenTables.map((key) => [key,
        snapshot[key].map((row) => ({ ...row, token_hash: { sealed: seal(String(row.token_hash)) } })),
      ])) };
    },
    restoreSnapshotFromPeer: async (input, open) => {
      const snapshot = readSnapshot(input);
      return { ...snapshot, ...Object.fromEntries(tokenTables.map((key) => [key, snapshot[key].map((row) => {
        if (!record(row.token_hash) || typeof row.token_hash.sealed !== "string") throw new Error("A Church Calendar feed or subscription was not protected for this standby.");
        const hash = open(row.token_hash.sealed);
        if (!tokenHash.test(hash)) throw new Error("A Church Calendar subscription hash is invalid.");
        return { ...row, token_hash: hash };
      })])) };
    },
    restoreDependencies: {
      moduleIds: ["core-site", "resource-scheduler"],
      validate(input, dependencies) {
        const core = dependencies.get("core-site");
        assertDependencies(readSnapshot(input), core);
        validateCalendarBookingSnapshots(input, dependencies.get("resource-scheduler"), core);
      },
    },
    async validateRestoreTarget(client, departmentId, input, replication) {
      const problems = await blockers(client, departmentId, replication);
      const blocker = problems.find((problem) => problem !== memberBlocker);
      if (blocker) throw new Error(blocker);
      if (input === undefined) {
        if (await count(client, departmentId)) throw new Error("The incoming standby snapshot omits existing Church Calendar data.");
        return;
      }
    },
    async prepareRestore(client, departmentId, input) {
      if (input === undefined) return;
      for (const key of ["calendars", "generations", "tags", "agendaPublications"] as const) {
        await client.query(`DELETE FROM ${tables[key].name} WHERE department_id=$1`, [departmentId]);
      }
    },
    async restoreSnapshot(client, departmentId, input, restoreContext) {
      const snapshot = readSnapshot(input);
      // Restore exceptions and extra dates before reminders and meeting requests.
      for (const key of keys) await insert(client, departmentId, key, snapshot[key], restoreContext);
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
          return { ready: false, blockers: [`Church Calendar ${key} differs from the signed snapshot.`] };
        }
      }
      return { ready: true, blockers: [] };
    },
  });
}
