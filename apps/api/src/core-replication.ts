import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { registerPlatformReplicationAdapter, type ReplicationExportContext, type ReplicationRestoreContext } from "./modules/module-sdk.js";

const snapshotTableNames = [
  "contacts", "service_events", "service_event_fact_definitions", "service_event_lifecycle_audit", "church_groups", "group_members", "church_teams", "team_members",
  "church_team_leaders", "bookable_resources", "resource_bookings", "group_meetings",
  "group_meeting_attendance", "event_volunteer_absences", "event_position_responses", "event_position_swap_requests", "event_attendance_checkins", "check_in_sessions", "check_in_pickup_authorizations", "worship_songs",
  "worship_song_arrangements", "service_plan_templates", "service_volunteer_qualifications", "contact_service_qualifications",
  "event_registrations", "event_registration_waitlist_notices", "department_memberships", "user_phone_numbers", "user_relationships", "app_users", "check_in_event_pickups",
] as const;
type SnapshotTable = typeof snapshotTableNames[number];
type CoreSnapshot = { version: number; sourceDepartmentId: string; department: { name: string; time_zone: string }; tables: Partial<Record<SnapshotTable, Array<Record<string, unknown>>>> };

function normalizeSnapshot(input: unknown): CoreSnapshot | null {
  if (!input || typeof input !== "object") return null;
  const snapshot = input as CoreSnapshot;
  if (!Number.isInteger(snapshot.version) || snapshot.version < 1 || snapshot.version > 37 || !snapshot.department || !snapshot.tables || !Array.isArray(snapshot.tables.contacts) || !Array.isArray(snapshot.tables.service_events) || !Array.isArray(snapshot.tables.church_groups)) return null;
  const tables = Object.fromEntries(snapshotTableNames.map((table) => [table, Array.isArray(snapshot.tables[table]) ? snapshot.tables[table] : []])) as CoreSnapshot["tables"];
  tables.event_registrations = (tables.event_registrations ?? []).map((row) => ({ ...row, cancellation_token_hash: row.cancellation_token_hash ?? null, additional_attendee: row.additional_attendee ?? false, party_id: row.party_id ?? null, answer_snapshot: row.answer_snapshot ?? [] }));
  tables.resource_bookings = (tables.resource_bookings ?? []).map((row) => ({ ...row, is_intake_request: row.is_intake_request ?? false, subtitle: row.subtitle ?? "", description: row.description ?? "", beneficiary_contact_id: row.beneficiary_contact_id ?? null }));
  tables.bookable_resources = (tables.bookable_resources ?? []).map((row) => ({ ...row, intake_only: row.intake_only ?? false, calendar_required: row.calendar_required ?? false, manager_booking_only: row.manager_booking_only ?? false, visibility_group_id: row.visibility_group_id ?? null, responsible_user_id: row.responsible_user_id ?? null }));
  tables.event_volunteer_absences = (tables.event_volunteer_absences ?? []).map((row) => ({ ...row, starts_at: row.starts_at ?? null, ends_at: row.ends_at ?? null }));
  tables.contacts = (tables.contacts ?? []).map((row) => ({ ...row, postal_address: row.postal_address ?? {}, archived_at: row.archived_at ?? null }));
  tables.service_events = (tables.service_events ?? []).map((row) => ({ ...row, responsible_contact_id: row.responsible_contact_id ?? null, recorded_facts: row.recorded_facts ?? null, registration_form_revision: row.registration_form_revision ?? null, registration_questions: row.registration_questions ?? [], live_run_sheet: row.live_run_sheet ?? null, shared_agenda_source_id: row.shared_agenda_source_id ?? null, shared_agenda_hidden_item_ids: row.shared_agenda_hidden_item_ids ?? [] }));
  const eventsById = new Map(tables.service_events.map((row) => [row.id, row]));
  function legacyItemId(sourceId: unknown, index: number) {
    const hex = createHash("sha256").update("shared-agenda-item:" + String(sourceId) + ":" + index).digest("hex");
    return [hex.slice(0, 8), hex.slice(8, 12), "4" + hex.slice(13, 16), "8" + hex.slice(17, 20), hex.slice(20, 32)].join("-");
  }
  for (const target of tables.service_events) {
    if (target.shared_agenda_source_id == null) continue;
    const source = eventsById.get(target.shared_agenda_source_id);
    if (!source || source === target || source.shared_agenda_source_id || source.department_id !== target.department_id
      || String(source.event_date) !== String(target.event_date) || source.is_all_day !== target.is_all_day
      || source.source_system || target.source_system || source.cancelled_at || target.cancelled_at
      || source.recurrence_id || target.recurrence_id) return null;
    if (!Array.isArray(source.time_plan) || !Array.isArray(target.time_plan) || !Array.isArray(target.shared_agenda_hidden_item_ids)) return null;
    if (snapshot.version < 34) {
      if (source.time_plan.length !== target.time_plan.length) return null;
      source.time_plan = source.time_plan.map((item, index) => ({ ...item, agendaItemId: legacyItemId(source.id, index) }));
      target.time_plan = target.time_plan.map((item, index) => ({ ...item, agendaItemId: legacyItemId(source.id, index) }));
    } else {
      const itemIds = new Set(source.time_plan.map((item) => item?.agendaItemId));
      if (itemIds.has(undefined) || itemIds.size !== source.time_plan.length || target.shared_agenda_hidden_item_ids.length > 100
        || target.shared_agenda_hidden_item_ids.some((id: unknown) => !itemIds.has(id))) return null;
    }
  }
  tables.worship_songs = (tables.worship_songs ?? []).map((row) => ({ ...row, bpm: row.bpm ?? null, time_signature: row.time_signature ?? null }));
  tables.group_members = (tables.group_members ?? []).map((row) => ({
    ...row, waitlist_priority: row.waitlist_priority ?? null, waitlisted_at: row.waitlisted_at ?? null,
  }));
  tables.church_groups = (tables.church_groups ?? []).map((raw) => {
    const row = { ...raw };
    if (row.status === undefined) row.status = "active";
    if (row.starts_on === undefined) row.starts_on = null;
    if (row.ends_on === undefined) row.ends_on = null;
    if (row.check_in_codes_enabled === undefined) row.check_in_codes_enabled = false;
    if (row.check_in_code_roles === undefined) row.check_in_code_roles = [];
    return row;
  });
  tables.resource_bookings = (tables.resource_bookings ?? []).map((row) => ({
    ...row,
    requester_actor_id: row.requester_actor_id ?? row.requested_by ?? null,
    requester_actor_name: row.requester_actor_name ?? null,
  }));
  return { ...snapshot, tables };
}

async function standbyReplicatedUserIds(client: Pick<PoolClient, "query">, departmentId: string) {
  const result = await client.query<{ role: string; replicated_user_ids: string[] }>("SELECT role,replicated_user_ids FROM sync_site_redundancy WHERE department_id=$1", [departmentId]);
  return result.rows[0]?.role === "standby" ? new Set(result.rows[0].replicated_user_ids ?? []) : null;
}

function replicationValue(value: unknown, dataType: string | undefined) {
  if (value === null || value === undefined) return null;
  if (dataType === "json" || dataType === "jsonb") return JSON.stringify(value);
  return value;
}

const exportQueries: Record<SnapshotTable, string> = {
  contacts: "SELECT * FROM contacts WHERE department_id=$1 ORDER BY id",
  service_events: "SELECT * FROM service_events WHERE department_id=$1 ORDER BY id",
  service_event_fact_definitions: "SELECT * FROM service_event_fact_definitions WHERE department_id=$1 ORDER BY id",
  service_event_lifecycle_audit: "SELECT * FROM service_event_lifecycle_audit WHERE department_id=$1 ORDER BY event_id,created_at,id",
  church_groups: "SELECT * FROM church_groups WHERE department_id=$1 ORDER BY id",
  group_members: "SELECT member.* FROM group_members member JOIN church_groups parent ON parent.id=member.group_id WHERE parent.department_id=$1 ORDER BY member.group_id,member.contact_id",
  church_teams: "SELECT * FROM church_teams WHERE department_id=$1 ORDER BY id",
  team_members: "SELECT member.* FROM team_members member JOIN church_teams parent ON parent.id=member.team_id WHERE parent.department_id=$1 ORDER BY member.team_id,member.contact_id",
  church_team_leaders: "SELECT leader.* FROM church_team_leaders leader JOIN church_teams parent ON parent.id=leader.team_id WHERE parent.department_id=$1 ORDER BY leader.team_id,leader.user_id",
  bookable_resources: "SELECT * FROM bookable_resources WHERE department_id=$1 ORDER BY id",
  resource_bookings: "SELECT * FROM resource_bookings WHERE department_id=$1 ORDER BY id",
  group_meetings: "SELECT * FROM group_meetings WHERE department_id=$1 ORDER BY id",
  group_meeting_attendance: "SELECT attendance.* FROM group_meeting_attendance attendance JOIN group_meetings parent ON parent.id=attendance.meeting_id WHERE parent.department_id=$1 ORDER BY attendance.meeting_id,attendance.contact_id",
  event_volunteer_absences: "SELECT * FROM event_volunteer_absences WHERE department_id=$1 ORDER BY contact_id,starts_on,id",
  event_position_responses: "SELECT response.* FROM event_position_responses response JOIN service_events parent ON parent.id=response.event_id WHERE parent.department_id=$1 ORDER BY response.event_id,response.position_index",
  event_position_swap_requests: "SELECT swap.* FROM event_position_swap_requests swap JOIN service_events parent ON parent.id=swap.event_id WHERE parent.department_id=$1 ORDER BY swap.id",
  event_attendance_checkins: "SELECT checkin.* FROM event_attendance_checkins checkin JOIN service_events parent ON parent.id=checkin.event_id WHERE parent.department_id=$1 ORDER BY checkin.event_id,checkin.contact_id",
  check_in_sessions: "SELECT * FROM check_in_sessions WHERE department_id=$1 ORDER BY event_id",
  check_in_pickup_authorizations: "SELECT * FROM check_in_pickup_authorizations WHERE department_id=$1 ORDER BY child_contact_id,authorized_contact_id",
  check_in_event_pickups: "SELECT * FROM check_in_event_pickups WHERE department_id=$1 ORDER BY event_id,child_contact_id,authorized_contact_id,id",
  event_registration_waitlist_notices: "SELECT * FROM event_registration_waitlist_notices WHERE department_id=$1 ORDER BY registration_id",
  event_registrations: "SELECT registration.* FROM event_registrations registration JOIN service_events parent ON parent.id=registration.event_id WHERE parent.department_id=$1 ORDER BY registration.id",
  worship_songs: "SELECT * FROM worship_songs WHERE department_id=$1 ORDER BY id",
  worship_song_arrangements: "SELECT arrangement.* FROM worship_song_arrangements arrangement JOIN worship_songs song ON song.id=arrangement.song_id WHERE song.department_id=$1 ORDER BY arrangement.id",
  service_plan_templates: "SELECT * FROM service_plan_templates WHERE department_id=$1 ORDER BY id",
  service_volunteer_qualifications: "SELECT * FROM service_volunteer_qualifications WHERE department_id=$1 ORDER BY id",
  contact_service_qualifications: "SELECT * FROM contact_service_qualifications WHERE department_id=$1 ORDER BY contact_id,qualification_id",
  department_memberships: "SELECT * FROM department_memberships WHERE department_id=$1 ORDER BY user_id",
  user_phone_numbers: "SELECT phone.* FROM user_phone_numbers phone JOIN department_memberships member ON member.user_id=phone.user_id WHERE member.department_id=$1 ORDER BY phone.user_id,phone.position",
  user_relationships: "SELECT relation.* FROM user_relationships relation WHERE relation.user_id IN (SELECT user_id FROM department_memberships WHERE department_id=$1) AND relation.related_user_id IN (SELECT user_id FROM department_memberships WHERE department_id=$1) ORDER BY relation.user_id,relation.related_user_id",
  // Account credentials and profile follow site membership. Server-wide roles
  // and permissions intentionally stay local to each installation.
  app_users: "SELECT DISTINCT account.id,account.email,account.username,account.display_name,account.password_hash,account.must_change_password,account.can_change_password,account.birthday,account.street,account.street_number,account.postal_code,account.city,account.date_time_format,account.language,account.language_is_custom,account.created_at,account.menu_preferences FROM app_users account JOIN department_memberships member ON member.user_id=account.id WHERE member.department_id=$1 ORDER BY account.id",
};

const deleteQueries = [
  "DELETE FROM event_volunteer_absences WHERE department_id=$1",
  "DELETE FROM contact_service_qualifications WHERE department_id=$1",
  "DELETE FROM service_volunteer_qualifications WHERE department_id=$1",
  "DELETE FROM service_plan_templates WHERE department_id=$1",
  "DELETE FROM event_registration_waitlist_notices WHERE department_id=$1",
  "DELETE FROM event_registrations WHERE event_id IN (SELECT id FROM service_events WHERE department_id=$1)",
  "DELETE FROM service_event_lifecycle_audit WHERE department_id=$1",
  "DELETE FROM event_attendance_checkins WHERE event_id IN (SELECT id FROM service_events WHERE department_id=$1)",
  "DELETE FROM check_in_sessions WHERE department_id=$1",
  "DELETE FROM check_in_pickup_authorizations WHERE department_id=$1",
  "DELETE FROM check_in_event_pickups WHERE department_id=$1",
  "DELETE FROM event_position_responses WHERE event_id IN (SELECT id FROM service_events WHERE department_id=$1)",
  "DELETE FROM event_position_swap_requests WHERE event_id IN (SELECT id FROM service_events WHERE department_id=$1)",
  "DELETE FROM group_meeting_attendance WHERE meeting_id IN (SELECT id FROM group_meetings WHERE department_id=$1)",
  "DELETE FROM group_meetings WHERE department_id=$1",
  "DELETE FROM resource_bookings WHERE department_id=$1",
  "DELETE FROM group_members WHERE group_id IN (SELECT id FROM church_groups WHERE department_id=$1)",
  "DELETE FROM team_members WHERE team_id IN (SELECT id FROM church_teams WHERE department_id=$1)",
  "DELETE FROM church_team_leaders WHERE team_id IN (SELECT id FROM church_teams WHERE department_id=$1)",
  "DELETE FROM department_memberships WHERE department_id=$1",
  "DELETE FROM church_groups WHERE department_id=$1",
  "DELETE FROM church_teams WHERE department_id=$1",
  "DELETE FROM bookable_resources WHERE department_id=$1",
  "DELETE FROM service_events WHERE department_id=$1",
  "DELETE FROM service_event_fact_definitions WHERE department_id=$1",
  "DELETE FROM contacts WHERE department_id=$1",
];

function objectRecord(value: unknown, table: SnapshotTable): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Core replication has an invalid ${table} row.`);
  return value as Record<string, unknown>;
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString("base64"));
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}

function mapUserFields(row: Record<string, unknown>, userIdMap: Map<string, string>) {
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string" && (key === "user_id" || key.endsWith("_user_id") || key.endsWith("_by") || key === "requested_by")) row[key] = userIdMap.get(value) ?? value;
  }
  return row;
}

async function collect(client: PoolClient, departmentId: string): Promise<CoreSnapshot> {
  const department = await client.query<{ name: string; time_zone: string }>("SELECT name,time_zone FROM departments WHERE id=$1", [departmentId]);
  if (!department.rowCount) throw new Error("The replicated site no longer exists.");
  const replicatedUserIds = await standbyReplicatedUserIds(client, departmentId);
  const tables: CoreSnapshot["tables"] = {};
  for (const table of snapshotTableNames) {
    const result = await client.query(exportQueries[table], [departmentId]);
    let rows = result.rows as Array<Record<string, unknown>>;
    if (replicatedUserIds) {
      if (table === "app_users") rows = rows.filter((row) => replicatedUserIds.has(String(row.id)));
      else if (table === "department_memberships" || table === "user_phone_numbers") rows = rows.filter((row) => replicatedUserIds.has(String(row.user_id)));
      else if (table === "user_relationships") rows = rows.filter((row) => replicatedUserIds.has(String(row.user_id)) && replicatedUserIds.has(String(row.related_user_id)));
    }
    tables[table] = rows;
  }
  return { version: 37, sourceDepartmentId: departmentId, department: department.rows[0], tables };
}

const dependentModuleRecords = [
  {
    moduleId: "church-calendar",
    // The other Calendar tables are children of these site-owned roots.
    tables: ["church_calendar_calendars", "church_calendar_event_generations", "church_calendar_tag_definitions", "church_calendar_agenda_publications"],
    message: "This location has Church Calendar records. A matching Calendar snapshot is required to preserve them.",
  },
  {
    moduleId: "people-records",
    tables: [
      "people_record_fields", "people_record_values", "people_record_relationships", "people_record_consents",
      "people_record_history", "people_record_import_audits", "people_record_person_dates", "people_record_merges",
      "people_record_saved_views", "people_record_relationship_types", "people_record_attachments", "people_record_households",
      "people_record_household_members", "people_record_private_notes", "people_growth_config", "people_personal_followups",
    ],
    message: "This location has People Records data. A matching People Records snapshot is required to preserve it.",
  },
  {
    moduleId: "finance",
    tables: [
      "finance_settings", "finance_accounts", "finance_cost_centers", "finance_donors",
      "finance_transactions", "finance_transaction_lines", "finance_budgets", "finance_audit",
      "finance_receipt_settings", "finance_receipt_batches", "finance_donation_receipts",
      "finance_bank_statement_imports", "finance_bank_statement_rows", "finance_bank_suggestion_rules",
      "finance_accounting_years", "finance_year_end_transfers", "finance_tax_types",
      "finance_transaction_evidence", "finance_journal_numbering", "finance_bank_statement_account_mappings",
      "finance_actor_attribution", "finance_bank_statement_suggestions", "finance_paypal_statement_keys", "finance_booking_purposes", "finance_simple_booking_grants",
    ],
    message: "This location has Finance & Giving data. A matching Finance snapshot is required to transfer it.",
  },
] as const;

async function dependentSnapshotBlockers(client: Pick<PoolClient, "query">, departmentId: string, replication?: ReplicationExportContext) {
  const omitted = dependentModuleRecords.filter(({ moduleId }) => !replication?.moduleIds.has(moduleId));
  if (!omitted.length) return [];
  const relations = (await client.query<{ name: string }>(`SELECT relation.name
    FROM unnest($1::text[]) AS relation(name) WHERE to_regclass('public.' || relation.name) IS NOT NULL`,
  [omitted.flatMap((module) => [...module.tables])])).rows;
  const existing = new Set(relations.map((relation) => relation.name));
  const blockers: string[] = [];
  for (const { tables, message } of omitted) {
    const queries = tables.filter((table) => existing.has(table)).map((table) =>
      `SELECT 1 FROM ${table} WHERE department_id=$1`);
    if (queries.length && (await client.query(`SELECT 1 FROM (${queries.join(" UNION ALL ")}) module_data LIMIT 1`, [departmentId])).rowCount) {
      blockers.push(message);
    }
  }
  return blockers;
}

async function countRecords(pool: Pool, departmentId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = await collect(client, departmentId);
    await client.query("COMMIT");
    return Object.values(snapshot.tables).reduce((total, rows) => total + (rows?.length ?? 0), 0);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export function registerCoreReplicationAdapter(pool: Pool) {
  return registerPlatformReplicationAdapter({
    moduleId: "core-site",
    schemaVersion: "28",
    inspect: async (departmentId, replication) => {
      const blockers = await dependentSnapshotBlockers(pool, departmentId, replication);
      const count = await countRecords(pool, departmentId);
      return { ready: !blockers.length, blockers, recordCount: count };
    },
    async exportSnapshot(client, departmentId, replication) {
      const blockers = await dependentSnapshotBlockers(client, departmentId, replication);
      if (blockers.length) throw new Error(blockers.join(" "));
      return collect(client, departmentId);
    },
    async validateRestoreTarget(client, departmentId, _snapshot, replication) {
      const blockers = await dependentSnapshotBlockers(client, departmentId, replication);
      if (blockers.length) throw new Error(blockers.join(" "));
    },
    restoreSnapshot: async (client, targetDepartmentId, input, restoreContext: ReplicationRestoreContext) => {
      const snapshot = normalizeSnapshot(input);
      if (!snapshot) throw new Error("The core site snapshot is incomplete or unsupported.");
      const tables = snapshot.tables;
      let recordCount = 0;
      const userIdMap = restoreContext.userIdMap;

      for (const userValue of tables.app_users ?? []) {
        const sourceUser = objectRecord(userValue, "app_users");
        const sourceId = String(sourceUser.id ?? "");
        const email = sourceUser.email == null ? null : String(sourceUser.email);
        if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(sourceId)) throw new Error("The core site snapshot contains an invalid user ID.");
        const username = String(sourceUser.username ?? "");
        const existingByEmail = email ? await client.query<{ id: string; role: string }>("SELECT id,role FROM app_users WHERE lower(email)=lower($1)", [email]) : { rows: [], rowCount: 0 };
        const existingById = await client.query<{ id: string; email: string | null; role: string }>("SELECT id,email,role FROM app_users WHERE id=$1", [sourceId]);
        if (existingByEmail.rowCount && existingByEmail.rows[0].id !== sourceId) {
          userIdMap.set(sourceId, existingByEmail.rows[0].id);
          await client.query(`UPDATE app_users SET email=$2,username=$3,display_name=$4,password_hash=$5,must_change_password=$6,can_change_password=$7,
              birthday=$8,street=$9,street_number=$10,postal_code=$11,city=$12,date_time_format=$13,language=$14,language_is_custom=$15,created_at=$16,menu_preferences=$17
            WHERE id=$1`, [existingByEmail.rows[0].id, email, username, sourceUser.display_name, sourceUser.password_hash,
            sourceUser.must_change_password, sourceUser.can_change_password ?? true, sourceUser.birthday, sourceUser.street, sourceUser.street_number,
            sourceUser.postal_code, sourceUser.city, sourceUser.date_time_format, sourceUser.language, sourceUser.language_is_custom, sourceUser.created_at, sourceUser.menu_preferences ?? null]);
          continue;
        }
        if (existingById.rowCount && email && existingById.rows[0].email && existingById.rows[0].email.toLowerCase() !== email.toLowerCase()) throw new Error("A local account conflicts with a replicated user ID. Resolve the account mapping before restoring this site.");
        if (existingById.rowCount) {
          userIdMap.set(sourceId, sourceId);
          await client.query(`UPDATE app_users SET email=$2,username=$3,display_name=$4,password_hash=$5,must_change_password=$6,can_change_password=$7,
              birthday=$8,street=$9,street_number=$10,postal_code=$11,city=$12,date_time_format=$13,language=$14,language_is_custom=$15,created_at=$16,menu_preferences=$17
            WHERE id=$1`, [sourceId, email, username, sourceUser.display_name, sourceUser.password_hash,
            sourceUser.must_change_password, sourceUser.can_change_password ?? true, sourceUser.birthday, sourceUser.street, sourceUser.street_number,
            sourceUser.postal_code, sourceUser.city, sourceUser.date_time_format, sourceUser.language, sourceUser.language_is_custom, sourceUser.created_at, sourceUser.menu_preferences ?? null]);
          continue;
        }
        const existingUsername = await client.query("SELECT 1 FROM app_users WHERE lower(username)=lower($1)", [username]);
        if (existingUsername.rowCount) throw new Error(`The username ${username} is already used by a different local account. Resolve the account conflict before restoring this site.`);
        const localUser: Record<string, unknown> = { ...sourceUser, role: "user", server_permissions: [] };
        const columns = Object.keys(localUser);
        const allowedColumns = new Set((await client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='app_users'")).rows.map((column) => column.column_name));
        if (columns.some((column) => !allowedColumns.has(column))) throw new Error("The core site snapshot contains user fields unsupported by this server version.");
        const insertedUser = await client.query(`INSERT INTO app_users (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(",")}) ON CONFLICT DO NOTHING`, columns.map((column) => localUser[column]));
        if (insertedUser.rowCount !== 1) throw new Error("The core site snapshot conflicts with an existing user account. Check the email and user ID on the standby.");
        userIdMap.set(sourceId, sourceId);
        recordCount += 1;
      }

      const replicatedUserIds = new Set(userIdMap.values());
      const localServerAdminMemberships = (await client.query<Record<string, unknown>>(
        `SELECT membership.user_id,membership.role,membership.contact_id,membership.permissions,membership.video_permissions,membership.presenter_permissions,membership.module_permissions
           FROM department_memberships membership JOIN app_users account ON account.id=membership.user_id
          WHERE membership.department_id=$1 AND account.role='server_admin'`, [targetDepartmentId],
      )).rows.filter((membership) => !replicatedUserIds.has(String(membership.user_id)));
      const localServerAdminIds = new Set(localServerAdminMemberships.map((membership) => String(membership.user_id)));
      const membershipIdsResult = await client.query<{ user_id: string }>("SELECT user_id FROM department_memberships WHERE department_id=$1", [targetDepartmentId]);
      const previousUsers = membershipIdsResult.rows.map((row) => row.user_id);
      const usersBeingReplaced = previousUsers.filter((userId) => !localServerAdminIds.has(userId));
      const removedFromSiteUsers = usersBeingReplaced.filter((userId) => !replicatedUserIds.has(userId));
      const usersWithOtherMemberships = new Set((await client.query<{ user_id: string }>(
        "SELECT DISTINCT user_id FROM department_memberships WHERE user_id=ANY($1::uuid[]) AND department_id<>$2",
        [removedFromSiteUsers, targetDepartmentId],
      )).rows.map((row) => row.user_id));
      const orphanedSiteUsers = removedFromSiteUsers.filter((userId) => !usersWithOtherMemberships.has(userId));
      // Phone numbers and relationships belong to accounts, not locations.
      // Replace phone data for replicated accounts, and clear stale accounts
      // only when they are not still used by another local location.
      const usersWithReplicatedPhones = [...new Set([...replicatedUserIds, ...orphanedSiteUsers])];
      // Module activation is server-local: some modules depend on hardware or
      // services reachable only from one installation. Replicate the site's
      // identity and schedule timezone without enabling source modules here.
      await client.query("UPDATE departments SET name=$2,time_zone=$3 WHERE id=$1", [targetDepartmentId, snapshot.department.name, snapshot.department.time_zone]);
      for (const query of deleteQueries) await client.query(query, [targetDepartmentId]);
      await client.query(`DELETE FROM user_relationships
        WHERE (user_id=ANY($1::uuid[]) AND related_user_id=ANY($1::uuid[]))
           OR user_id=ANY($2::uuid[]) OR related_user_id=ANY($2::uuid[])`, [[...replicatedUserIds], orphanedSiteUsers]);
      await client.query("DELETE FROM user_phone_numbers WHERE user_id=ANY($1::uuid[])", [usersWithReplicatedPhones]);

      const insertOrder: SnapshotTable[] = ["contacts", "department_memberships", "user_phone_numbers", "user_relationships", "service_volunteer_qualifications", "contact_service_qualifications", "service_event_fact_definitions", "service_events", "service_event_lifecycle_audit", "church_groups", "church_teams", "bookable_resources", "worship_songs", "worship_song_arrangements", "service_plan_templates", "group_members", "team_members", "church_team_leaders", "group_meetings", "resource_bookings", "group_meeting_attendance", "event_volunteer_absences", "event_position_responses", "event_position_swap_requests", "event_attendance_checkins", "check_in_sessions", "check_in_pickup_authorizations", "check_in_event_pickups", "event_registrations", "event_registration_waitlist_notices"];
      const upsertQueries: Partial<Record<SnapshotTable, string>> = {
        // Worship library rows are soft-deleted and referenced by the
        // ChurchTools/Elvanto integration module. Updating them in place keeps
        // those module-owned foreign keys valid across repeated snapshots.
        worship_songs: `INSERT INTO worship_songs(id,department_id,title,authors,default_key,notes,active,created_at,updated_at,bpm,time_signature)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET bpm=EXCLUDED.bpm,time_signature=EXCLUDED.time_signature,department_id=EXCLUDED.department_id,title=EXCLUDED.title,authors=EXCLUDED.authors,default_key=EXCLUDED.default_key,notes=EXCLUDED.notes,active=EXCLUDED.active,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at`,
        worship_song_arrangements: `INSERT INTO worship_song_arrangements(id,song_id,name,musical_key,chart_url,audio_url,active,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET song_id=EXCLUDED.song_id,name=EXCLUDED.name,musical_key=EXCLUDED.musical_key,chart_url=EXCLUDED.chart_url,audio_url=EXCLUDED.audio_url,active=EXCLUDED.active,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at`,
      };
      const jsonColumns = await client.query<{ table_name: string; column_name: string; data_type: string }>(
        "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) AND data_type IN ('json','jsonb')",
        [insertOrder],
      );
      const jsonTypes = new Map(jsonColumns.rows.map((column) => [`${column.table_name}.${column.column_name}`, column.data_type]));
      for (const table of insertOrder) {
        if (table === "resource_bookings") await restoreContext.beforeCoreResourceBookings?.(client, targetDepartmentId);
        for (const raw of tables[table] ?? []) {
          const row = { ...objectRecord(raw, table) };
          if ("department_id" in row) row.department_id = targetDepartmentId;
          if (table === "department_memberships") row.user_id = userIdMap.get(String(row.user_id)) ?? row.user_id;
          if (table === "user_phone_numbers" || table === "event_registration_waitlist_notices") row.user_id = userIdMap.get(String(row.user_id)) ?? row.user_id;
          if (table === "user_relationships") {
            row.user_id = userIdMap.get(String(row.user_id)) ?? row.user_id;
            row.related_user_id = userIdMap.get(String(row.related_user_id)) ?? row.related_user_id;
          }
          if (table === "bookable_resources" && row.responsible_user_id != null) row.responsible_user_id = userIdMap.get(String(row.responsible_user_id)) ?? null;
          if (table === "resource_bookings") row.requested_by = userIdMap.get(String(row.requested_by)) ?? null;
          if (table === "church_team_leaders") row.user_id = userIdMap.get(String(row.user_id)) ?? row.user_id;
          if (table === "check_in_pickup_authorizations") {
            row.created_by = userIdMap.get(String(row.created_by)) ?? row.created_by;
            row.guardian_confirmed_by = userIdMap.get(String(row.guardian_confirmed_by)) ?? row.guardian_confirmed_by;
          }
          if (table === "check_in_sessions" && row.completed_by != null) row.completed_by = userIdMap.get(String(row.completed_by)) ?? null;
          if (table === "check_in_event_pickups") {
            if (row.guardian_confirmed_by != null) row.guardian_confirmed_by = userIdMap.get(String(row.guardian_confirmed_by)) ?? null;
            if (row.released_by != null) row.released_by = userIdMap.get(String(row.released_by)) ?? null;
          }
          if (table === "service_volunteer_qualifications") row.created_by = userIdMap.get(String(row.created_by)) ?? row.created_by;
          if (table === "contact_service_qualifications") row.granted_by = userIdMap.get(String(row.granted_by)) ?? row.granted_by;
          if (table === "service_events" && row.cancelled_by != null) row.cancelled_by = userIdMap.get(String(row.cancelled_by)) ?? null;
          if (table === "service_event_lifecycle_audit" && row.actor_user_id != null) row.actor_user_id = userIdMap.get(String(row.actor_user_id)) ?? null;
          if (table === "church_groups") {
            row.status ??= "active";
            row.starts_on ??= null;
            row.ends_on ??= null;
          }
          const columns = table === "worship_songs"
            ? ["id", "department_id", "title", "authors", "default_key", "notes", "active", "created_at", "updated_at", "bpm", "time_signature"]
            : Object.keys(row);
          const values = columns.map((column) => replicationValue(row[column], jsonTypes.get(`${table}.${column}`)));
          const placeholders = columns.map((_, index) => `$${index + 1}`);
          const inserted = await client.query(upsertQueries[table] ?? `INSERT INTO public."${table}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${placeholders.join(",")}) ON CONFLICT DO NOTHING`, values);
          if (!upsertQueries[table] && inserted.rowCount !== 1) throw new Error(`The core site snapshot conflicts with existing ${table} data. Restore was rolled back.`);
          recordCount += 1;
        }
      }
      for (const membership of localServerAdminMemberships) {
        const contactId = typeof membership.contact_id === "string"
          && (await client.query("SELECT 1 FROM contacts WHERE id=$1 AND department_id=$2", [membership.contact_id, targetDepartmentId])).rowCount
          ? membership.contact_id
          : null;
        await client.query(
          `INSERT INTO department_memberships(user_id,department_id,role,contact_id,permissions,video_permissions,presenter_permissions,module_permissions)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(user_id,department_id) DO NOTHING`,
          [membership.user_id, targetDepartmentId, membership.role, contactId, membership.permissions ?? [], membership.video_permissions ?? [], membership.presenter_permissions ?? [], JSON.stringify(membership.module_permissions ?? {})],
        );
      }
      await client.query("UPDATE sync_site_redundancy SET replicated_user_ids=$2::uuid[] WHERE department_id=$1 AND role='standby'", [targetDepartmentId, [...replicatedUserIds]]);
      return { recordCount };
    },
    verifySnapshot: async (client, departmentId, input, context) => {
      const snapshot = normalizeSnapshot(input);
      if (!snapshot) return { ready: false, blockers: ["No verified core-site snapshot is available."] };
      const userIdMap = context?.userIdMap ?? new Map<string, string>();
      for (const table of snapshotTableNames) {
        const expectedRows = snapshot.tables[table] ?? [];
        let actualRows = (await client.query(exportQueries[table], [departmentId])).rows as Array<Record<string, unknown>>;
        const replicatedUserIds = await standbyReplicatedUserIds(client, departmentId);
        if (replicatedUserIds) {
          if (table === "app_users") actualRows = actualRows.filter((row) => replicatedUserIds.has(String(row.id)));
          else if (table === "department_memberships" || table === "user_phone_numbers") actualRows = actualRows.filter((row) => replicatedUserIds.has(String(row.user_id)));
          else if (table === "user_relationships") actualRows = actualRows.filter((row) => replicatedUserIds.has(String(row.user_id)) && replicatedUserIds.has(String(row.related_user_id)));
        }
        if (actualRows.length !== expectedRows.length) return { ready: false, blockers: [`${table} has ${actualRows.length} rows; expected ${expectedRows.length}.`] };
        if (table === "app_users") {
          for (const source of expectedRows) {
            const mappedId = userIdMap.get(String(source.id)) ?? String(source.id);
            const actual = actualRows.find((row) => row.id === mappedId);
            if (!actual || canonical(actual) !== canonical({ ...source, id: mappedId })) return { ready: false, blockers: ["Account identity or sign-in data verification failed."] };
          }
          continue;
        }
        const expected = expectedRows.map((source) => {
          const row = mapUserFields({ ...source }, userIdMap);
          if (table === "resource_bookings") row.requested_by = userIdMap.get(String(source.requested_by)) ?? null;
          if (table === "bookable_resources" && source.responsible_user_id != null) row.responsible_user_id = userIdMap.get(String(source.responsible_user_id)) ?? null;
          if (table === "check_in_sessions" && source.completed_by != null) row.completed_by = userIdMap.get(String(source.completed_by)) ?? null;
          if ("department_id" in row) row.department_id = departmentId;
          return canonical(row);
        }).sort();
        const actual = actualRows.map(canonical).sort();
        if (expected.some((row, index) => row !== actual[index])) return { ready: false, blockers: [`${table} content verification failed.`] };
      }
      return { ready: true, blockers: [] };
    },
  });
}
