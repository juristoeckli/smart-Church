import type { Pool, PoolClient } from "pg";
import { registerPlatformReplicationAdapter, type ReplicationRestoreContext } from "./modules/module-sdk.js";

const snapshotTableNames = [
  "contacts", "service_events", "church_groups", "group_members", "church_teams", "team_members",
  "church_team_leaders", "bookable_resources", "resource_bookings", "group_meetings",
  "group_meeting_attendance", "event_position_responses", "event_attendance_checkins",
  "event_registrations", "department_memberships", "user_phone_numbers", "user_relationships", "app_users",
] as const;
type SnapshotTable = typeof snapshotTableNames[number];
type CoreSnapshot = { version: 4; sourceDepartmentId: string; department: { name: string; time_zone: string; enabled_modules: string[] }; tables: Partial<Record<SnapshotTable, Array<Record<string, unknown>>>> };

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
  church_groups: "SELECT * FROM church_groups WHERE department_id=$1 ORDER BY id",
  group_members: "SELECT member.* FROM group_members member JOIN church_groups parent ON parent.id=member.group_id WHERE parent.department_id=$1 ORDER BY member.group_id,member.contact_id",
  church_teams: "SELECT * FROM church_teams WHERE department_id=$1 ORDER BY id",
  team_members: "SELECT member.* FROM team_members member JOIN church_teams parent ON parent.id=member.team_id WHERE parent.department_id=$1 ORDER BY member.team_id,member.contact_id",
  church_team_leaders: "SELECT leader.* FROM church_team_leaders leader JOIN church_teams parent ON parent.id=leader.team_id WHERE parent.department_id=$1 ORDER BY leader.team_id,leader.user_id",
  bookable_resources: "SELECT * FROM bookable_resources WHERE department_id=$1 ORDER BY id",
  resource_bookings: "SELECT * FROM resource_bookings WHERE department_id=$1 ORDER BY id",
  group_meetings: "SELECT * FROM group_meetings WHERE department_id=$1 ORDER BY id",
  group_meeting_attendance: "SELECT attendance.* FROM group_meeting_attendance attendance JOIN group_meetings parent ON parent.id=attendance.meeting_id WHERE parent.department_id=$1 ORDER BY attendance.meeting_id,attendance.contact_id",
  event_position_responses: "SELECT response.* FROM event_position_responses response JOIN service_events parent ON parent.id=response.event_id WHERE parent.department_id=$1 ORDER BY response.event_id,response.position_index",
  event_attendance_checkins: "SELECT checkin.* FROM event_attendance_checkins checkin JOIN service_events parent ON parent.id=checkin.event_id WHERE parent.department_id=$1 ORDER BY checkin.event_id,checkin.contact_id",
  event_registrations: "SELECT registration.* FROM event_registrations registration JOIN service_events parent ON parent.id=registration.event_id WHERE parent.department_id=$1 ORDER BY registration.id",
  department_memberships: "SELECT * FROM department_memberships WHERE department_id=$1 ORDER BY user_id",
  user_phone_numbers: "SELECT phone.* FROM user_phone_numbers phone JOIN department_memberships member ON member.user_id=phone.user_id WHERE member.department_id=$1 ORDER BY phone.user_id,phone.position",
  user_relationships: "SELECT relation.* FROM user_relationships relation WHERE relation.user_id IN (SELECT user_id FROM department_memberships WHERE department_id=$1) AND relation.related_user_id IN (SELECT user_id FROM department_memberships WHERE department_id=$1) ORDER BY relation.user_id,relation.related_user_id",
  // Account credentials and profile follow site membership. Server-wide roles
  // and permissions intentionally stay local to each installation.
  app_users: "SELECT DISTINCT account.id,account.email,account.username,account.display_name,account.password_hash,account.must_change_password,account.birthday,account.street,account.street_number,account.postal_code,account.city,account.date_time_format,account.language,account.language_is_custom,account.created_at FROM app_users account JOIN department_memberships member ON member.user_id=account.id WHERE member.department_id=$1 ORDER BY account.id",
};

const deleteQueries = [
  "DELETE FROM event_registrations WHERE event_id IN (SELECT id FROM service_events WHERE department_id=$1)",
  "DELETE FROM event_attendance_checkins WHERE event_id IN (SELECT id FROM service_events WHERE department_id=$1)",
  "DELETE FROM event_position_responses WHERE event_id IN (SELECT id FROM service_events WHERE department_id=$1)",
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
  const department = await client.query<{ name: string; time_zone: string; enabled_modules: string[] }>("SELECT name,time_zone,enabled_modules FROM departments WHERE id=$1", [departmentId]);
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
  return { version: 4, sourceDepartmentId: departmentId, department: department.rows[0], tables };
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
    schemaVersion: "4",
    inspect: async (departmentId) => {
      const count = await countRecords(pool, departmentId);
      return { ready: true, blockers: [], recordCount: count };
    },
    exportSnapshot: (client, departmentId) => collect(client, departmentId),
    restoreSnapshot: async (client, targetDepartmentId, input, restoreContext: ReplicationRestoreContext) => {
      if (!input || typeof input !== "object" || (input as CoreSnapshot).version !== 4 || !Array.isArray((input as CoreSnapshot).tables?.contacts) || !(input as CoreSnapshot).department) throw new Error("The core site snapshot is incomplete or unsupported.");
      const snapshot = input as CoreSnapshot;
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
          await client.query(`UPDATE app_users SET email=$2,username=$3,display_name=$4,password_hash=$5,must_change_password=$6,
              birthday=$7,street=$8,street_number=$9,postal_code=$10,city=$11,date_time_format=$12,language=$13,language_is_custom=$14,created_at=$15
            WHERE id=$1`, [existingByEmail.rows[0].id, email, username, sourceUser.display_name, sourceUser.password_hash,
            sourceUser.must_change_password, sourceUser.birthday, sourceUser.street, sourceUser.street_number,
            sourceUser.postal_code, sourceUser.city, sourceUser.date_time_format, sourceUser.language, sourceUser.language_is_custom, sourceUser.created_at]);
          continue;
        }
        if (existingById.rowCount && email && existingById.rows[0].email && existingById.rows[0].email.toLowerCase() !== email.toLowerCase()) throw new Error("A local account conflicts with a replicated user ID. Resolve the account mapping before restoring this site.");
        if (existingById.rowCount) {
          userIdMap.set(sourceId, sourceId);
          await client.query(`UPDATE app_users SET email=$2,username=$3,display_name=$4,password_hash=$5,must_change_password=$6,
              birthday=$7,street=$8,street_number=$9,postal_code=$10,city=$11,date_time_format=$12,language=$13,language_is_custom=$14,created_at=$15
            WHERE id=$1`, [sourceId, email, username, sourceUser.display_name, sourceUser.password_hash,
            sourceUser.must_change_password, sourceUser.birthday, sourceUser.street, sourceUser.street_number,
            sourceUser.postal_code, sourceUser.city, sourceUser.date_time_format, sourceUser.language, sourceUser.language_is_custom, sourceUser.created_at]);
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
      // Module activation is server-local: some modules depend on hardware or
      // services reachable only from one installation. Replicate the site's
      // identity and schedule timezone without enabling source modules here.
      await client.query("UPDATE departments SET name=$2,time_zone=$3 WHERE id=$1", [targetDepartmentId, snapshot.department.name, snapshot.department.time_zone]);
      for (const query of deleteQueries) await client.query(query, [targetDepartmentId]);
      await client.query("DELETE FROM user_relationships WHERE user_id=ANY($1::uuid[]) OR related_user_id=ANY($1::uuid[])", [usersBeingReplaced]);
      await client.query("DELETE FROM user_phone_numbers WHERE user_id=ANY($1::uuid[])", [usersBeingReplaced]);

      const insertOrder: SnapshotTable[] = ["contacts", "department_memberships", "user_phone_numbers", "user_relationships", "service_events", "church_groups", "church_teams", "bookable_resources", "group_members", "team_members", "church_team_leaders", "group_meetings", "resource_bookings", "group_meeting_attendance", "event_position_responses", "event_attendance_checkins", "event_registrations"];
      const jsonColumns = await client.query<{ table_name: string; column_name: string; data_type: string }>(
        "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) AND data_type IN ('json','jsonb')",
        [insertOrder],
      );
      const jsonTypes = new Map(jsonColumns.rows.map((column) => [`${column.table_name}.${column.column_name}`, column.data_type]));
      for (const table of insertOrder) {
        for (const raw of tables[table] ?? []) {
          const row = { ...objectRecord(raw, table) };
          if ("department_id" in row) row.department_id = targetDepartmentId;
          if (table === "department_memberships") row.user_id = userIdMap.get(String(row.user_id)) ?? row.user_id;
          if (table === "user_phone_numbers") row.user_id = userIdMap.get(String(row.user_id)) ?? row.user_id;
          if (table === "user_relationships") {
            row.user_id = userIdMap.get(String(row.user_id)) ?? row.user_id;
            row.related_user_id = userIdMap.get(String(row.related_user_id)) ?? row.related_user_id;
          }
          if (table === "resource_bookings") row.requested_by = userIdMap.get(String(row.requested_by)) ?? row.requested_by;
          if (table === "church_team_leaders") row.user_id = userIdMap.get(String(row.user_id)) ?? row.user_id;
          const columns = Object.keys(row);
          const values = columns.map((column) => replicationValue(row[column], jsonTypes.get(`${table}.${column}`)));
          const placeholders = columns.map((_, index) => `$${index + 1}`);
          const inserted = await client.query(`INSERT INTO public."${table}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${placeholders.join(",")}) ON CONFLICT DO NOTHING`, values);
          if (inserted.rowCount !== 1) throw new Error(`The core site snapshot conflicts with existing ${table} data. Restore was rolled back.`);
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
      if (!input || typeof input !== "object" || (input as CoreSnapshot).version !== 4) return { ready: false, blockers: ["No verified core-site snapshot is available."] };
      const snapshot = input as CoreSnapshot;
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
