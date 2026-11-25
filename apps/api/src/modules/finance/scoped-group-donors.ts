import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { groupFinanceAccessJoins } from "./simple-booking.js";

type Context = Pick<ModuleServerContext, "pool" | "resolveDepartmentId" | "isDatabaseReady">;
type Center = { id: string; code: string; name: string };
type Donor = { displayName: string; donorType: "individual" | "joint" };
const uuid = { type: "string", format: "uuid" } as const;

async function donorCenters(db: Pool | PoolClient, departmentId: string, userId: string, center?: string, lock = false) {
  return (await db.query<Center>(`
    SELECT center.id,center.code,center.name
      ${groupFinanceAccessJoins}
      JOIN finance_cost_centers center ON center.department_id=permission.department_id AND center.id=permission.cost_center_id AND center.active
     WHERE access.department_id=$1 AND access.user_id=$2 AND (access.module_permissions->'finance') ? 'group-donors-view'
       AND permission.can_view_donors AND ($3::uuid IS NULL OR center.id=$3)
     ORDER BY lower(center.name),center.id
     ${lock ? "FOR SHARE OF access,contact,membership,parent,permission,center" : ""}`,
  [departmentId,userId,center ?? null])).rows;
}

export function registerScopedGroupDonors(app: FastifyInstance, { pool, resolveDepartmentId, isDatabaseReady }: Context) {
  const path = "/api/modules/finance/group-donors";

  async function authorize(request: FastifyRequest, reply: FastifyReply) {
    if (!pool || !isDatabaseReady()) {
      reply.code(503).send({ error: "Finance is unavailable because the database is not ready." }); return null;
    }
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return null;
    const userId = request.authenticatedUser?.id;
    if (!userId || !(request.activeDepartmentModulePermissions?.finance ?? []).includes("group-donors-view")) {
      reply.code(403).send({ error: "Group donor view access is required." }); return null;
    }
    return { departmentId,userId };
  }

  app.get(path, async (request, reply) => {
    const scope = await authorize(request, reply); if (!scope) return reply;
    const centers = new Map((await donorCenters(pool!,scope.departmentId,scope.userId)).map(center => [center.id,center]));
    return reply.header("Cache-Control","private, no-store").send({ centers:[...centers.values()] });
  });

  app.get<{ Params: { id: string }; Querystring: { page?: number } }>(path + "/centers/:id", {
    schema: { params: { type: "object", required: ["id"], properties: { id: uuid } },
      querystring: { type: "object", properties: { page: { type: "integer", minimum: 1, maximum: 100000 } } },
    },
  }, async (request, reply) => {
    const scope = await authorize(request, reply); if (!scope) return reply;
    const { departmentId,userId } = scope;
    const { id } = request.params, { page = 1 } = request.query;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const [center] = await donorCenters(client,departmentId,userId,id,true);
      if (!center) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Cost center not found for your group." });
      }
      // Only positive donor-linked income in this center establishes a donor relationship.
      const donors = (await client.query<Donor>(`
        SELECT donor.display_name AS "displayName",donor.donor_type AS "donorType"
          FROM finance_donors donor
         WHERE donor.department_id=$1 AND EXISTS (
           SELECT 1 FROM finance_transaction_lines line
           JOIN finance_transactions journal ON journal.department_id=line.department_id AND journal.id=line.transaction_id
             AND journal.status='posted' AND journal.reverses_transaction_id IS NULL
           JOIN finance_accounts account ON account.department_id=line.department_id AND account.id=line.account_id AND account.account_type='income'
           WHERE line.department_id=donor.department_id AND line.donor_id=donor.id
             AND line.cost_center_id=$2 AND line.credit_cents>0
         )
         ORDER BY lower(donor.display_name),donor.id LIMIT 51 OFFSET $3`,
      [departmentId,id,(page-1)*50])).rows;
      await client.query("COMMIT");
      return reply.header("Cache-Control","private, no-store").send({ page,donors:donors.slice(0,50),hasMore:donors.length>50 });
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  });
}
