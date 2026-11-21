import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

function withdrawalHash(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export function createGroupWithdrawalReceipt() {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: withdrawalHash(secret) };
}

export function registerPublicGroupWithdrawal(routes: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, lockDepartmentForWrite, realtime } = context;
  routes.post<{ Body: { receiptToken: string } }>("/api/public/group-signups/withdraw", {
    schema: { body: { type: "object", additionalProperties: false, required: ["receiptToken"],
      properties: { receiptToken: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" } },
    } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (!pool || !isDatabaseReady()) return reply.code(503).send({ error: "Group registration is temporarily unavailable." });
    const hash = withdrawalHash(request.body.receiptToken);
    const client = await pool.connect();
    let changed: { group_id: string; department_id: string } | null = null;
    try {
      await client.query("BEGIN");
      const scope = await client.query<{ id: string; department_id: string }>(
        "SELECT id,department_id FROM group_join_requests WHERE withdrawal_hash=$1", [hash],
      );
      if (!scope.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "This withdrawal link is unavailable." });
      }
      const { id, department_id: departmentId } = scope.rows[0];
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This group's location is read-only." });
      }
      const result = await client.query<{ status: string; group_id: string; department_id: string }>(
        "SELECT status,group_id,department_id FROM group_join_requests WHERE id=$1 AND department_id=$2 AND withdrawal_hash=$3 FOR UPDATE",
        [id, departmentId, hash],
      );
      const row = result.rows[0];
      if (!row || (row.status !== "pending" && row.status !== "withdrawn")) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Only requests still waiting for review can be withdrawn. Contact the group leaders for help." });
      }
      if (row.status === "pending") {
        await client.query("UPDATE group_join_requests SET status='withdrawn',withdrawn_at=now() WHERE id=$1 AND department_id=$2", [id, departmentId]);
        changed = row;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    if (changed) realtime.publish("core:groups:changed", changed.department_id, { groupId: changed.group_id, action: "join-withdrawn" });
    return { status: "withdrawn" };
  });
}
