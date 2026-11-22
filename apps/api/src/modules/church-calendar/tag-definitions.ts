import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

type TagInput = { name: string; color?: string | null; description?: string };
const fields = {
  name: { type: "string", minLength: 1, maxLength: 40 },
  color: { anyOf: [{ type: "string", pattern: "^#[0-9a-fA-F]{6}$" }, { type: "null" }] },
  description: { type: "string", maxLength: 500 },
} as const;
const bodySchema = { type: "object", required: ["name"], additionalProperties: false, properties: fields } as const;
const paramsSchema = { type: "object", required: ["key"], additionalProperties: false, properties: {
  key: { type: "string", minLength: 1, maxLength: 40 },
} } as const;

export function registerCalendarTagDefinitions(app: FastifyInstance, context: ModuleServerContext, canManage: (request: FastifyRequest) => boolean) {
  const endpoint = "/api/modules/church-calendar/tag-definitions";
  app.get(endpoint, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Calendar storage is unavailable." });
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await context.pool.query(
      `SELECT tag_key AS key,name,color,description FROM church_calendar_tag_definitions
        WHERE department_id=$1 ORDER BY lower(name),tag_key`, [departmentId],
    );
    return reply.header("Cache-Control", "no-store").send(result.rows);
  });

  app.post<{ Body: TagInput }>(endpoint, { schema: { body: bodySchema } }, save);
  app.put<{ Body: TagInput; Params: { key: string } }>(`${endpoint}/:key`, { schema: { body: bodySchema, params: paramsSchema } }, save);
  app.delete<{ Params: { key: string } }>(`${endpoint}/:key`, { schema: { params: paramsSchema } }, save);

  async function save(request: FastifyRequest<{ Body?: TagInput; Params?: { key: string } }>, reply: import("fastify").FastifyReply) {
    const pool = context.pool;
    if (!pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Calendar storage is unavailable." });
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (!canManage(request)) return reply.code(403).send({ error: "Calendar management is required to edit tag definitions." });
    const name = request.method === "DELETE" ? "" : request.body!.name.trim();
    if (request.method !== "DELETE" && (!name || /[,\x00-\x1f\x7f]/.test(name))) {
      return reply.code(400).send({ error: "Enter a tag name without commas or control characters." });
    }
    const key = request.method === "POST" ? name.toLowerCase() : request.params!.key;
    if (key.length > 40) return reply.code(400).send({ error: "The tag name is too long." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const result = request.method === "DELETE"
        ? await client.query("DELETE FROM church_calendar_tag_definitions WHERE department_id=$1 AND tag_key=$2 RETURNING tag_key AS key",
          [departmentId, key])
        : await client.query(request.method === "POST"
          ? `INSERT INTO church_calendar_tag_definitions(department_id,tag_key,name,color,description) VALUES($1,$2,$3,$4,$5)
             RETURNING tag_key AS key,name,color,description`
          : `UPDATE church_calendar_tag_definitions SET name=$3,color=$4,description=$5 WHERE department_id=$1 AND tag_key=$2
             RETURNING tag_key AS key,name,color,description`,
          [departmentId, key, name, request.body?.color?.toLowerCase() ?? null, request.body?.description?.trim() ?? ""],
        );
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Tag definition not found." });
      }
      await client.query("COMMIT");
      context.realtime.publish("module:church-calendar:changed", departmentId, { action: "tag-definition-changed" });
      return reply.code(request.method === "POST" ? 201 : 200).send(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string })?.code === "23505") return reply.code(409).send({ error: "A tag definition already uses this name or key." });
      throw error;
    } finally {
      client.release();
    }
  }
}
