import { loadGroupMeetingPins, restoreGroupMeetingPins } from "./group-meeting-pins.js";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type GroupJoinRequest = Record<string, unknown>;
type FormRow = { department_id: string; group_id: string; revision: string; questions: unknown[]; opens_at?: string | Date | null; closes_at?: string | Date | null; default_role?: string; heading?: string; active_seat_limit?: number | null; waitlist_limit?: number | null; counted_roles?: string[]; connected_admission?: boolean };
type Snapshot = { version: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; groupJoinRequests: GroupJoinRequest[]; signupForms?: FormRow[]; meetingPins?: Awaited<ReturnType<typeof loadGroupMeetingPins>> };
const requestColumns = "id,department_id,group_id,first_name,last_name,email,status,contact_id,created_at,reviewed_at,reviewed_by,answer_snapshot,withdrawal_hash,withdrawn_at";
async function loadForms(client: PoolClient, departmentId: string) {
  return (await client.query<FormRow>(
    "SELECT department_id,group_id,revision,questions,opens_at,closes_at,default_role,heading,active_seat_limit,waitlist_limit,counted_roles,connected_admission FROM group_signup_forms WHERE department_id=$1 ORDER BY group_id", [departmentId],
  )).rows;
}
const maxSnapshotBytes = 50 * 1024 * 1024;

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])).join(",") + "}";
  return JSON.stringify(value);
}

function remapReviewer(row: GroupJoinRequest, userIdMap: Map<string, string>, departmentId?: string) {
  const copy: GroupJoinRequest = { ...row, answer_snapshot: row.answer_snapshot ?? [], withdrawal_hash: row.withdrawal_hash ?? null, withdrawn_at: row.withdrawn_at ?? null };
  if (departmentId && typeof copy.department_id === "string") copy.department_id = departmentId;
  if (typeof copy.reviewed_by === "string") copy.reviewed_by = userIdMap.get(copy.reviewed_by) ?? copy.reviewed_by;
  return copy;
}

export function registerCommunityReplication(context: ModuleServerContext) {
  const { pool, isDatabaseReady } = context;
  context.replication.register({
    schemaVersion: "9",
    inspect: async (departmentId) => {
      if (!pool || !isDatabaseReady()) return { ready: false, blockers: ["Community database is unavailable."], recordCount: 0 };
      try {
        const result = await pool.query<{ count: string; bytes: string }>(`SELECT count(*)::text AS count,
            COALESCE(sum(pg_column_size(record)),0)::text AS bytes
          FROM (
            SELECT to_jsonb(request) AS record FROM group_join_requests request WHERE request.department_id=$1
            UNION ALL SELECT to_jsonb(form) FROM group_signup_forms form WHERE form.department_id=$1
            UNION ALL SELECT to_jsonb(pin) FROM group_meeting_pins pin WHERE pin.department_id=$1
          ) data`, [departmentId]);
        const row = result.rows[0];
        const blockers = Number(row.bytes) > maxSnapshotBytes ? ["Community group-join requests exceed the 50 MiB snapshot limit."] : [];
        return { ready: !blockers.length, blockers, recordCount: Number(row.count) };
      } catch {
        return { ready: false, blockers: ["Community group-join request storage is not initialized on this server."], recordCount: 0 };
      }
    },
    exportSnapshot: async (client: PoolClient, departmentId) => {
      const result = await client.query(`SELECT ${requestColumns}
        FROM group_join_requests WHERE department_id=$1 ORDER BY created_at,id`, [departmentId]);
      return { version: 9, groupJoinRequests: result.rows, signupForms: await loadForms(client, departmentId),
        meetingPins: await loadGroupMeetingPins(client, departmentId) };
    },
    restoreSnapshot: async (client: PoolClient, departmentId, input, restoreContext) => {
      const snapshot = input as Snapshot;
      if (!snapshot || (snapshot.version !== 2 && snapshot.version !== 3 && snapshot.version !== 4 && snapshot.version !== 5 && snapshot.version !== 6 && snapshot.version !== 7 && snapshot.version !== 8 && snapshot.version !== 9) || !Array.isArray(snapshot.groupJoinRequests) || snapshot.groupJoinRequests.length > 100_000 || Buffer.byteLength(JSON.stringify(snapshot)) > maxSnapshotBytes) throw new Error("The Community group-join request snapshot is invalid or exceeds the supported limits.");
      if (snapshot.version >= 4 && (!Array.isArray(snapshot.signupForms) || snapshot.signupForms.length > 100_000)) throw new Error("The Community signup-form snapshot is invalid.");
      if (snapshot.version === 9 && (!Array.isArray(snapshot.meetingPins) || snapshot.meetingPins.length > 100_000)) {
        throw new Error("The Community meeting-pin snapshot is invalid.");
      }
      await restoreGroupMeetingPins(client, departmentId, snapshot.version === 9 ? snapshot.meetingPins ?? [] : []);
      await client.query("DELETE FROM group_signup_forms WHERE department_id=$1", [departmentId]);
      for (const form of snapshot.signupForms ?? []) {
        if (!Array.isArray(form.questions) || typeof form.group_id !== "string" || typeof form.revision !== "string") throw new Error("The Community snapshot contains an invalid signup form.");
        const inserted = await client.query(
          `INSERT INTO group_signup_forms(department_id,group_id,revision,questions,opens_at,closes_at,default_role,heading,active_seat_limit,waitlist_limit,counted_roles,connected_admission)
           SELECT $1,id,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12 FROM church_groups WHERE department_id=$1 AND id=$2`,
          [departmentId, form.group_id, form.revision, JSON.stringify(form.questions), form.opens_at ?? null, form.closes_at ?? null, form.default_role ?? "Member", form.heading ?? "", form.active_seat_limit ?? null, form.waitlist_limit ?? null, form.counted_roles ?? [], form.connected_admission ?? false],
        );
        if (!inserted.rowCount) throw new Error("A signup form references a group outside the restored location.");
      }
      await client.query("DELETE FROM group_join_requests WHERE department_id=$1", [departmentId]);
      for (const source of snapshot.groupJoinRequests) {
        if (typeof source.id !== "string" || typeof source.group_id !== "string" || typeof source.first_name !== "string" || typeof source.last_name !== "string" || typeof source.email !== "string" || !(snapshot.version === 2 ? ["pending", "approved", "declined"] : snapshot.version < 8 ? ["pending", "approved", "declined", "waitlisted"] : ["pending", "approved", "declined", "waitlisted", "withdrawn"]).includes(String(source.status))) throw new Error("The Community snapshot contains an invalid group-join request.");
        const row = remapReviewer(source, restoreContext.userIdMap);
        await client.query(`INSERT INTO group_join_requests(${requestColumns})
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`, [row.id, departmentId, row.group_id, row.first_name, row.last_name, row.email, row.status, row.contact_id, row.created_at, row.reviewed_at, row.reviewed_by, JSON.stringify(row.answer_snapshot), row.withdrawal_hash, row.withdrawn_at]);
      }
      return { recordCount: snapshot.groupJoinRequests.length + (snapshot.signupForms?.length ?? 0) + (snapshot.version === 9 ? snapshot.meetingPins?.length ?? 0 : 0) };
    },
    verifySnapshot: async (client: PoolClient, departmentId, input, restoreContext) => {
      const snapshot = input as Snapshot;
      if (!snapshot || (snapshot.version !== 2 && snapshot.version !== 3 && snapshot.version !== 4 && snapshot.version !== 5 && snapshot.version !== 6 && snapshot.version !== 7 && snapshot.version !== 8 && snapshot.version !== 9) || !Array.isArray(snapshot.groupJoinRequests)) return { ready: false, blockers: ["No supported Community group-join request snapshot is available."] };
      const actual = (await client.query(`SELECT ${requestColumns}
        FROM group_join_requests WHERE department_id=$1 ORDER BY created_at,id`, [departmentId])).rows as GroupJoinRequest[];
      const expectedRows = snapshot.groupJoinRequests.map((row) => canonical(remapReviewer(row, restoreContext?.userIdMap ?? new Map(), departmentId))).sort();
      const actualRows = actual.map(canonical).sort();
      const expectedForms = (snapshot.signupForms ?? []).map((form) => canonical({ ...form, department_id: departmentId, opens_at: form.opens_at ?? null, closes_at: form.closes_at ?? null, default_role: form.default_role ?? "Member", heading: form.heading ?? "", active_seat_limit: form.active_seat_limit ?? null, waitlist_limit: form.waitlist_limit ?? null, counted_roles: form.counted_roles ?? [], connected_admission: form.connected_admission ?? false })).sort();
      const actualForms = (await loadForms(client, departmentId)).map(canonical).sort();
      if (canonical(expectedForms) !== canonical(actualForms)) return { ready: false, blockers: ["Community signup forms differ from the source snapshot after restore."] };
      const expectedPins = (snapshot.version === 9 && Array.isArray(snapshot.meetingPins) ? snapshot.meetingPins : []).map(canonical).sort();
      const actualPins = (await loadGroupMeetingPins(client, departmentId)).map(canonical).sort();
      if ((snapshot.version === 9 && !Array.isArray(snapshot.meetingPins)) || canonical(expectedPins) !== canonical(actualPins)) {
        return { ready: false, blockers: ["Community meeting pins differ from the source snapshot after restore."] };
      }
      const matches = expectedRows.length === actualRows.length && expectedRows.every((row, index) => row === actualRows[index]);
      return matches ? { ready: true, blockers: [] } : { ready: false, blockers: ["Community group-join requests differ from the source snapshot after restore."] };
    },
  });
}
