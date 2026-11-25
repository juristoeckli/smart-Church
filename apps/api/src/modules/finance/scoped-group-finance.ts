import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { costCenterBudgetSql, costCenterScopeSql, scopedCostCenterEntriesSql, type StatementBudget, type StatementScope } from "./cost-center-detail.js";
import { groupFinanceAccessJoins } from "./simple-booking.js";

type ScopedCenter = { id: string; code: string; name: string; canViewJournal: boolean };
type Period = { year: number; label: string };
type ScopedEntry = {
  date: string; lineText: string; bookingText: string | null; receiptNumber: string | null;
  accountCode: string; accountName: string; debitCents: string; creditCents: string; isCostCenterTransfer: boolean;
};
type Context = Pick<ModuleServerContext, "pool" | "resolveDepartmentId" | "isDatabaseReady">;
const uuid = { type: "string", format: "uuid" } as const;

async function centersForUser(db: Pool | PoolClient, departmentId: string, userId: string, center?: string, lock = false) {
  return (await db.query<ScopedCenter>(`
    SELECT center.id,center.code,center.name,permission.can_view_journal AS "canViewJournal"
      ${groupFinanceAccessJoins}
      JOIN finance_cost_centers center ON center.department_id=permission.department_id AND center.id=permission.cost_center_id AND center.active
     WHERE access.department_id=$1 AND access.user_id=$2 AND (access.module_permissions->'finance') ? 'group-finance-view'
       AND permission.can_view_budget AND ($3::uuid IS NULL OR center.id=$3)
     ORDER BY lower(center.name),center.id,permission.can_view_journal DESC
     ${lock ? "FOR SHARE OF access,contact,membership,parent,permission,center" : ""}`,
  [departmentId,userId,center ?? null])).rows;
}

export function registerScopedGroupFinance(app: FastifyInstance, { pool, resolveDepartmentId, isDatabaseReady }: Context) {
  const path = "/api/modules/finance/group-finance";

  async function authorize(request: FastifyRequest, reply: FastifyReply) {
    if (!pool || !isDatabaseReady()) {
      reply.code(503).send({ error: "Finance is unavailable because the database is not ready." }); return null;
    }
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return null;
    const userId = request.authenticatedUser?.id;
    if (!userId || !(request.activeDepartmentModulePermissions?.finance ?? []).includes("group-finance-view")) {
      reply.code(403).send({ error: "Group finance view access is required." }); return null;
    }
    return { departmentId,userId };
  }

  app.get(path, async (request, reply) => {
    const scope = await authorize(request, reply); if (!scope) return reply;
    const rows = await centersForUser(pool!,scope.departmentId,scope.userId);
    const centers = new Map<string,ScopedCenter>();
    for (const row of rows) if (!centers.has(row.id)) centers.set(row.id,row);
    const periods = centers.size ? (await pool!.query<Period>(
      "SELECT accounting_year AS year,label FROM finance_accounting_years WHERE department_id=$1 ORDER BY accounting_year DESC",
      [scope.departmentId],
    )).rows : [];
    return reply.header("Cache-Control","private, no-store").send({ centers:[...centers.values()],periods });
  });

  app.get<{ Params: { id: string }; Querystring: { year: number; page?: number; includeTransfers?: boolean } }>(path + "/centers/:id", {
    schema: { params: { type: "object", required: ["id"], properties: { id: uuid } },
      querystring: { type: "object", required: ["year"], properties: {
        year: { type: "integer", minimum: 1900, maximum: 2200 }, page: { type: "integer", minimum: 1, maximum: 100000 },
        includeTransfers: { type: "boolean" },
      } },
    },
  }, async (request, reply) => {
    const scope = await authorize(request, reply); if (!scope) return reply;
    const { departmentId,userId } = scope;
    const { id } = request.params;
    const { year,page = 1,includeTransfers = false } = request.query;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const [center] = await centersForUser(client,departmentId,userId,id,true);
      if (!center) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Cost center not found for your group." });
      }
      const { rows:[period] } = await client.query<StatementScope>(costCenterScopeSql,[departmentId,id,year]);
      if (!period) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Accounting year not found." });
      }
      const window = [departmentId,id,year,period.fiscalStart,period.fiscalEnd];
      const budgets = (await client.query<StatementBudget>(costCenterBudgetSql,[...window,1001])).rows;
      const entries = center.canViewJournal
        ? (await client.query<ScopedEntry>(scopedCostCenterEntriesSql,[...window,51,(page-1)*50,includeTransfers])).rows
        : undefined;
      await client.query("COMMIT");
      return reply.header("Cache-Control","private, no-store").send({
        center,period,budgets:budgets.slice(0,1000),hasMoreBudgets:budgets.length>1000,
        ...(entries ? { journal:{ page,entries:entries.slice(0,50),hasMore:entries.length>50 } } : {}),
      });
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  });
}
