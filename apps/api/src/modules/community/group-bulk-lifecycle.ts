import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GroupLifecycleStatus } from "@smart-church/contracts";
import type { ModuleServerContext } from "../module-sdk.js";

const uuid = { type: "string", format: "uuid" } as const;
const lifecycle = { type: "string", enum: ["active", "draft", "ended", "archived"] } as const;
type Target = { id: string; status: GroupLifecycleStatus };
type Location = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;

export function registerBulkGroupLifecycle(routes: FastifyInstance, context: ModuleServerContext, location: Location) {
  const { pool, validateMutation, lockDepartmentForWrite, realtime } = context;
  routes.patch<{ Body: { groups: Target[]; status: "active" | "archived" } }>("/api/groups/bulk-lifecycle", {
    schema: { body: { type: "object", additionalProperties: false, required: ["groups", "status"], properties: {
      status: { type: "string", enum: ["active", "archived"] },
      groups: { type: "array", minItems: 1, maxItems: 100, items: {
        type: "object", additionalProperties: false, required: ["id", "status"], properties: { id: uuid, status: lifecycle },
      } },
    } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const { groups, status } = request.body;
    const expected = new Map(groups.map(group => [group.id.toLowerCase(), group.status]));
    if (expected.size !== groups.length) return reply.code(400).send({ error: "Select each group only once." });

    const client = await pool!.connect();
    let updated = 0;
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const current = await client.query<Target & { source_system: string | null }>(
        "SELECT id,status,source_system FROM church_groups WHERE department_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
        [departmentId, [...expected.keys()]],
      );
      if (current.rows.length !== expected.size || current.rows.some(group => group.source_system)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Choose existing local groups from this location." });
      }
      if (current.rows.some(group => expected.get(group.id) !== group.status)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "A selected group changed status. Refresh the group list and try again." });
      }

      const changedIds = current.rows.filter(group => group.status !== status).map(group => group.id);
      if (changedIds.length) {
        await client.query("SELECT set_config('smart_church.actor_id',$1,true),set_config('smart_church.department_id',$2,true)",
          [request.authenticatedUser!.id, departmentId]);
        const result = await client.query(
          `UPDATE church_groups SET status=$3,public_signup_enabled=false,public_signup_token=NULL,updated_at=now()
            WHERE department_id=$1 AND id=ANY($2::uuid[])`,
          [departmentId, changedIds, status],
        );
        updated = result.rowCount ?? 0;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }

    if (updated) realtime.publish("core:groups:changed", departmentId, { action: "lifecycle-updated" });
    return { updated, unchanged: expected.size - updated };
  });
}
