import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

type DepartmentResolver = (request: FastifyRequest, reply: FastifyReply, write?: boolean) => Promise<string | null>;
type ImportRow = { firstName: string; lastName: string; email?: string };
const uuid = { type: "string", format: "uuid" } as const;

export function registerGroupMembershipImport(routes: FastifyInstance, context: ModuleServerContext, department: DepartmentResolver, activeGroupPredicate: string) {
  routes.post<{ Body: { groupId: string; rows: ImportRow[] } }>("/api/people-records/group-membership-import-preview", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groupId", "rows"], properties: {
      groupId: uuid,
      rows: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false,
        required: ["firstName", "lastName"], properties: {
          firstName: { type: "string", maxLength: 100 }, lastName: { type: "string", maxLength: 100 },
          email: { type: "string", maxLength: 254 },
        },
      } },
    } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !context.validateMutation(request, reply)) return reply;
    if (request.activeDepartmentRole !== "site_admin" && !(request.activeDepartmentPermissions ?? []).includes("groups_manage")) {
      return reply.code(403).send({ error: "You need group management permission to import memberships." });
    }
    const { groupId, rows } = request.body;
    const group = await context.pool!.query(
      `SELECT 1 FROM church_groups g WHERE g.id=$1 AND g.department_id=$2 AND ${activeGroupPredicate}
        AND COALESCE(to_jsonb(g)->>'source_system','') NOT IN ('churchtools','elvanto')`,
      [groupId, departmentId],
    );
    if (!group.rowCount) return reply.code(409).send({ error: "Choose an active local group." });
    const normalized = rows.map(row => {
      const firstName = row.firstName.trim(), lastName = row.lastName.trim(), email = (row.email ?? "").trim();
      const valid = Boolean(firstName && lastName) && ![firstName,lastName,email].some(value => value.includes("\u0000"))
        && (!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
      return valid ? { firstName, lastName, email } : null;
    });
    const result = await context.pool!.query<{ row: number; ids: string[]; existing: boolean }>(
      `SELECT input.ordinality::int AS row,matched.ids,matched.existing
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY input(data,ordinality)
         CROSS JOIN LATERAL (
           WITH candidates AS (
             SELECT c.id FROM contacts c
              WHERE c.department_id=$1 AND c.archived_at IS NULL
                AND lower(btrim(c.first_name))=lower(input.data->>'firstName')
                AND lower(btrim(c.last_name))=lower(input.data->>'lastName')
                AND (input.data->>'email'='' OR lower(btrim(c.email))=lower(input.data->>'email'))
              ORDER BY c.id LIMIT 2
           )
           SELECT ARRAY(SELECT id FROM candidates) AS ids, EXISTS(
             SELECT 1 FROM candidates JOIN group_members member ON member.contact_id=candidates.id AND member.group_id=$2
           ) AS existing
         ) matched
         ORDER BY input.ordinality`,
      [departmentId, groupId, JSON.stringify(normalized)],
    );
    const eligible = new Set<string>();
    const preview = result.rows.map(({ row, ids, existing }) => {
      if (!normalized[row - 1]) return { row, decision: "invalid" };
      if (ids.length === 0) return { row, decision: "missing" };
      if (ids.length > 1) return { row, decision: "ambiguous" };
      if (existing) return { row, decision: "existing" };
      const [contactId] = ids;
      if (eligible.has(contactId)) return { row, decision: "duplicate" };
      eligible.add(contactId);
      return { row, decision: "ready", contactId };
    });
    return reply.header("Cache-Control", "private, no-store").send({ rows: preview });
  });
}
