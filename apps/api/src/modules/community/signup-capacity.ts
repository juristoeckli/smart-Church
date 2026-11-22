import type { Pool, PoolClient } from "pg";
import type { SignupPolicyDraft } from "./signup-policy.js";

type Destination = "active" | "waitlist";

export async function groupAdmissionSlots(
  client: Pool | PoolClient,
  departmentId: string,
  groupId: string,
  destination: Destination,
  role: string,
  policy: SignupPolicyDraft,
  excludedContactId?: string,
) {
  const limit = destination === "active" ? policy.activeSeatLimit : policy.waitlistLimit;
  if (limit == null) return null;
  const roles = destination === "active" ? policy.countedRoles ?? [] : [];
  const result = await client.query<{ count: string; counts: boolean }>(
    `WITH roles AS (SELECT array_agg(lower(trim(label))) AS names FROM unnest($3::text[]) configured(label))
     SELECT (
       SELECT count(*)::text FROM group_members member
         JOIN contacts person ON person.id=member.contact_id AND person.department_id=$1
        WHERE member.group_id=$2 AND member.status=$4
          AND ($6::uuid IS NULL OR member.contact_id<>$6)
          AND (roles.names IS NULL OR lower(trim(member.role))=ANY(roles.names))
     ) AS count, (roles.names IS NULL OR lower(trim($5::text))=ANY(roles.names)) AS counts FROM roles`,
    [departmentId, groupId, roles, destination, role, excludedContactId ?? null],
  );
  return result.rows[0].counts ? Math.max(0, limit - Number(result.rows[0].count)) : null;
}

// Review and promotion writes hold the native group row lock before counting.
export async function checkGroupAdmissionCapacity(
  client: PoolClient,
  departmentId: string,
  groupId: string,
  destination: Destination,
  role: string,
  policy: SignupPolicyDraft,
  excludedContactId?: string,
) {
  if (await groupAdmissionSlots(client, departmentId, groupId, destination, role, policy, excludedContactId) !== 0) return null;
  return destination === "active"
    ? "The admission seat limit has been reached. Leave the application pending or choose the waitlist."
    : "The admission waitlist limit has been reached.";
}
