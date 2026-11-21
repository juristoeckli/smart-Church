import type { Pool, PoolClient } from "pg";

export type GroupMembershipDraft = { contactId: string; role: string; status: "active" | "paused" | "waitlist"; joinedOn?: string | null };
type WaitlistRow = { contactId: string; role: string; firstName: string; lastName: string; activeContact: boolean };

export const groupMemberDraftSchema = {
  type: "object", additionalProperties: false, required: ["contactId", "role", "status"], properties: {
    contactId: { type: "string", format: "uuid" }, role: { type: "string", minLength: 1, maxLength: 80 },
    status: { type: "string", enum: ["active", "paused", "waitlist"] },
    joinedOn: { type: ["string", "null"], format: "date" },
  },
} as const;

export function groupMembershipState(rows: GroupMembershipDraft[]) {
  return JSON.stringify(rows.map(({ contactId, role, status, joinedOn }) => [contactId, role, status, joinedOn ?? null])
    .sort(([left], [right]) => String(left).localeCompare(String(right))));
}

export async function groupWaitlist(db: Pool | PoolClient, departmentId: string, groupId: string, lock = false) {
  const result = await db.query<WaitlistRow>(
    `SELECT member.contact_id AS "contactId",member.role,person.first_name AS "firstName",person.last_name AS "lastName",(person.archived_at IS NULL) AS "activeContact"
       FROM group_members member
       JOIN contacts person ON person.id=member.contact_id AND person.department_id=$1
      WHERE member.group_id=$2 AND member.status='waitlist'
      ORDER BY member.waitlist_priority NULLS LAST,COALESCE(member.waitlisted_at,member.added_at),member.contact_id
      ${lock ? "FOR UPDATE OF member" : ""}`,
    [departmentId, groupId],
  );
  return result.rows.map((row, index) => ({ ...row, position: index + 1 }));
}
