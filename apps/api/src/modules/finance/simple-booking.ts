import { simpleEvidenceSchema, type SimpleEvidenceInput } from "./transaction-evidence.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

const uuid = { type: "string", format: "uuid" } as const;
const capabilityProperties = {
  canPost: { type: "boolean" }, canViewBudget: { type: "boolean" }, canViewJournal: { type: "boolean" }, canViewDonors: { type: "boolean" },
} as const;
const grantInput = {
  type: "object", additionalProperties: false, required: ["groupId", "role", "costCenterId"],
  properties: { groupId: uuid, role: { type: "string", minLength: 1, maxLength: 80 }, costCenterId: uuid, ...capabilityProperties },
} as const;
export const simpleBookingInput = {
  type: "object", additionalProperties: false, required: ["purposeId", "bookingDate", "bookingText", "amountCents", "currency"],
  properties: {
    purposeId: uuid, submissionId: uuid,
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    bookingDate: { type: "string", format: "date" }, bookingText: { type: "string", minLength: 1, maxLength: 500 },
    amountCents: { type: "integer", minimum: 1, maximum: 9000000000000000 },
    receiptNumber: { type: "string", minLength: 1, maxLength: 80 },
    receipts: simpleEvidenceSchema,
  },
} as const;

export type SimpleBookingBody = {
  purposeId: string; submissionId?: string; bookingDate: string; bookingText: string; receiptNumber?: string; amountCents: number; currency: string; receipts?: SimpleEvidenceInput[];
};
type SimplePurpose = {
  id: string; name: string; direction: "income" | "expense"; groupId: string; grantId: string; groupRole: string;
  bankAccountId: string; counterAccountId: string; costCenterId: string;
};
type Capabilities = { canPost: boolean; canViewBudget: boolean; canViewJournal: boolean; canViewDonors: boolean };
type GrantInput = { groupId: string; role: string; costCenterId: string } & Partial<Capabilities>;
type GrantChange = { active?: boolean } & Partial<Capabilities>;
type Grant = GrantInput & Capabilities & { id: string; active: boolean; groupName: string | null };
type Dependencies = {
  department(request: FastifyRequest, reply: FastifyReply, write: boolean): Promise<string | null>;
  audit(client: PoolClient, departmentId: string, request: FastifyRequest, action: string, kind: string, id: string, details: Record<string, unknown>): Promise<void>;
};

export const groupFinanceAccessJoins = `
    FROM department_memberships access
    JOIN contacts contact ON contact.id=access.contact_id AND contact.department_id=access.department_id AND contact.archived_at IS NULL
    JOIN group_members membership ON membership.contact_id=contact.id AND membership.status='active'
    JOIN church_groups parent ON parent.id=membership.group_id AND parent.department_id=access.department_id AND COALESCE(to_jsonb(parent)->>'status','active')='active'
    JOIN finance_simple_booking_grants permission ON permission.department_id=access.department_id AND permission.group_id=parent.id
      AND permission.active AND lower(permission.membership_role)=lower(trim(membership.role))
`;

export async function scopedSimplePurposes(db: Pool | PoolClient, departmentId: string, userId: string, purposeId?: string, lock = false) {
  return (await db.query<SimplePurpose>(`
    SELECT purpose.id,purpose.name,purpose.direction,permission.group_id AS "groupId",permission.id AS "grantId",membership.role AS "groupRole",
      purpose.bank_account_id AS "bankAccountId",purpose.counter_account_id AS "counterAccountId",purpose.cost_center_id AS "costCenterId"
    ${groupFinanceAccessJoins}
    JOIN finance_booking_purposes purpose ON purpose.department_id=permission.department_id AND purpose.cost_center_id=permission.cost_center_id AND purpose.active
    JOIN finance_cost_centers center ON center.department_id=purpose.department_id AND center.id=purpose.cost_center_id AND center.active
    JOIN finance_accounts bank ON bank.department_id=purpose.department_id AND bank.id=purpose.bank_account_id AND bank.active AND bank.account_type='asset'
    JOIN finance_accounts counter ON counter.department_id=purpose.department_id AND counter.id=purpose.counter_account_id
      AND counter.active AND counter.account_type=purpose.direction
    WHERE access.department_id=$1 AND access.user_id=$2 AND (access.module_permissions->'finance') ? 'simple-booking' AND permission.can_post
      AND ($3::uuid IS NULL OR purpose.id=$3)
    ORDER BY purpose.sort_order,lower(purpose.name),purpose.id,parent.id,permission.id
    ${lock ? "FOR SHARE OF access,contact,membership,parent,permission,purpose,center,bank,counter" : ""}`,
    [departmentId, userId, purposeId ?? null],
  )).rows;
}

export function registerSimpleBookingGrants(app: FastifyInstance, context: ModuleServerContext, deps: Dependencies) {
  const path = "/api/modules/finance/simple-booking/grants";
  const { pool, validateMutation, lockDepartmentForWrite } = context;
  const { department, audit } = deps;
  const params = { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } } as const;

  app.get(path, async (request, reply) => {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    const [groups, grants] = await Promise.all([
      pool!.query(`SELECT parent.id,parent.name,
        COALESCE(array_agg(DISTINCT trim(member.role) ORDER BY trim(member.role)) FILTER (WHERE member.role IS NOT NULL), '{}') AS roles
        FROM church_groups parent LEFT JOIN group_members member ON member.group_id=parent.id AND member.status='active'
        WHERE parent.department_id=$1 AND COALESCE(to_jsonb(parent)->>'status','active')='active' GROUP BY parent.id ORDER BY lower(parent.name),parent.id`, [departmentId]),
      pool!.query<Grant>(`SELECT entry.id,entry.group_id AS "groupId",entry.membership_role AS role,entry.cost_center_id AS "costCenterId",
        entry.active,entry.can_post AS "canPost",entry.can_view_budget AS "canViewBudget",entry.can_view_journal AS "canViewJournal",entry.can_view_donors AS "canViewDonors",
        parent.name AS "groupName" FROM finance_simple_booking_grants entry
        LEFT JOIN church_groups parent ON parent.id=entry.group_id AND parent.department_id=entry.department_id
        WHERE entry.department_id=$1 ORDER BY entry.active DESC,lower(parent.name),entry.membership_role,entry.id`, [departmentId]),
    ]);
    return { groups: groups.rows, grants: grants.rows };
  });

  async function write(request: FastifyRequest, reply: FastifyReply, input: GrantInput | ({ id: string } & GrantChange)) {
    const departmentId = await department(request, reply, true); if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const existingId = "id" in input ? input.id : undefined;
    const id = existingId ?? randomUUID();
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK"); return reply.code(423).send({ error: "This location is read-only." });
      }
      const previous = "id" in input ? (await client.query<Grant>(`SELECT id,group_id AS "groupId",membership_role AS role,
        cost_center_id AS "costCenterId",active,
        can_post AS "canPost",can_view_budget AS "canViewBudget",can_view_journal AS "canViewJournal",can_view_donors AS "canViewDonors" FROM finance_simple_booking_grants WHERE department_id=$1 AND id=$2 FOR UPDATE`,
      [departmentId, id])).rows[0] : undefined;
      if ("id" in input && !previous) {
        await client.query("ROLLBACK"); return reply.code(404).send({ error: "Simple booking grant not found." });
      }
      const scope = "id" in input ? previous! : { ...input, role: input.role.trim() };
      const active = ("id" in input ? input.active ?? previous?.active : undefined) ?? true;
      const canPost = input.canPost ?? previous?.canPost ?? true;
      const canViewBudget = input.canViewBudget ?? previous?.canViewBudget ?? false;
      const canViewJournal = input.canViewJournal ?? previous?.canViewJournal ?? false;
      const canViewDonors = input.canViewDonors ?? previous?.canViewDonors ?? false;
      if ((!canPost && !canViewBudget && !canViewDonors) || (canViewJournal && !canViewBudget)) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "Choose booking, budget, or donor access. Journal access includes budgets." });
      }

      if (active) {
        if (!scope.role) {
          await client.query("ROLLBACK"); return reply.code(400).send({ error: "Enter the group role to grant." });
        }
        const references = await client.query(`SELECT 1 FROM church_groups parent
          JOIN finance_cost_centers center ON center.id=$3 AND center.department_id=parent.department_id AND center.active
          WHERE parent.department_id=$1 AND parent.id=$2 AND COALESCE(to_jsonb(parent)->>'status','active')='active'
          LIMIT 1 FOR SHARE OF parent,center`,
        [departmentId,scope.groupId,scope.costCenterId]);
        if (!references.rowCount) {
          await client.query("ROLLBACK"); return reply.code(400).send({ error: "Choose an active group and cost center from this location." });
        }
      }

      if (existingId) {
        await client.query(`UPDATE finance_simple_booking_grants SET active=$3,can_post=$4,can_view_budget=$5,can_view_journal=$6,can_view_donors=$7,updated_at=now()
          WHERE department_id=$1 AND id=$2`, [departmentId,id,active,canPost,canViewBudget,canViewJournal,canViewDonors]);
      } else {
        await client.query(`INSERT INTO finance_simple_booking_grants(department_id,id,group_id,membership_role,cost_center_id,can_post,can_view_budget,can_view_journal,can_view_donors)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [departmentId,id,scope.groupId,scope.role,scope.costCenterId,canPost,canViewBudget,canViewJournal,canViewDonors]);
      }
      await audit(client, departmentId, request, existingId ? "simple_booking_grant_updated" : "simple_booking_grant_created", "simple_booking_grant", id,
        { groupId: scope.groupId, role: scope.role, costCenterId: scope.costCenterId, active, canPost, canViewBudget, canViewJournal, canViewDonors });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "This group role already has a scope for this cost center." });
      throw error;
    } finally { client.release(); }
    return reply.code(existingId ? 200 : 201).send({ id });
  }

  app.post<{ Body: GrantInput }>(path, { schema: { body: grantInput } }, (request, reply) => write(request, reply, request.body));
  app.patch<{ Params: { id: string }; Body: GrantChange }>(path+"/:id", {
    schema: { params, body: { type: "object", additionalProperties: false, minProperties: 1, properties: { active: { type: "boolean" }, ...capabilityProperties } } },
  }, (request, reply) => write(request, reply, { id: request.params.id, ...request.body }));
}
