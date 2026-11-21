import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { canManageStoredFileWikiAudience, hasWikiFileAudienceSchema, storedFileWikiAudienceSql } from "./stored-file-wiki-access.js";

type Context = {
  pool: Pool | null;
  available: () => boolean;
  resolveScope: (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
  validateMutation: (request: FastifyRequest, reply: FastifyReply) => boolean;
  lockDepartmentForWrite: (client: PoolClient, departmentId: string) => Promise<boolean>;
};
type EventFile = { id: string; title: string; fileName: string; fileSize: number; attached: boolean };
const uuid = { type: "string", format: "uuid" };
const eventParams = { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } };
const fileParams = { type: "object", additionalProperties: false, required: ["id", "fileId"], properties: { id: uuid, fileId: uuid } };
const activeLocalEvent = "SELECT id FROM service_events WHERE department_id=$1 AND id=$2 AND cancelled_at IS NULL AND source_system IS NULL";

export function registerServiceEventFilesRoutes(app: FastifyInstance, context: Context) {
  async function department(request: FastifyRequest, reply: FastifyReply) {
    reply.header("Cache-Control", "private, no-store");
    if (!context.pool || !context.available()) { reply.code(503).send({ error: "Event attachments are unavailable." }); return null; }
    const id = await context.resolveScope(request, reply);
    if (!id) return null;
    if (!await hasWikiFileAudienceSchema(context.pool)) {
      reply.code(503).send({ error: "File sharing permissions are unavailable." });
      return null;
    }
    return id;
  }

  app.get<{ Params: { id: string }; Querystring: { search?: string } }>("/api/events/:id/files", {
    schema: { params: eventParams, querystring: { type: "object", additionalProperties: false, properties: {
      search: { type: "string", maxLength: 120 },
    } } },
  }, async (request, reply) => {
    const dept = await department(request, reply);
    if (!dept) return reply;
    const event = await context.pool!.query(activeLocalEvent, [dept, request.params.id]);
    if (!event.rowCount) return reply.code(404).send({ error: "Active local event not found." });
    const visible = await context.pool!.query<EventFile>(`WITH eligible AS (
      SELECT stored.id,stored.title,stored.file_name AS "fileName",stored.file_size AS "fileSize",(link.file_id IS NOT NULL) AS attached
      FROM stored_files stored
      LEFT JOIN service_event_files link ON link.department_id=stored.department_id AND link.file_id=stored.id AND link.event_id=$4
      WHERE stored.department_id=$1 AND stored.deleted_at IS NULL AND ${storedFileWikiAudienceSql}
        AND (link.file_id IS NOT NULL OR $5::text='' OR strpos(lower(stored.title),lower($5))>0 OR strpos(lower(stored.file_name),lower($5))>0)
    )
    SELECT * FROM eligible WHERE attached
    UNION ALL
    (SELECT * FROM eligible WHERE NOT attached ORDER BY title,id LIMIT 100)
    ORDER BY title,id`, [dept, canManageStoredFileWikiAudience(request), request.authenticatedUser!.id, request.params.id, request.query.search?.trim() ?? ""]);
    return { attached: visible.rows.filter((file) => file.attached), available: visible.rows.filter((file) => !file.attached) };
  });

  async function changeAttachment(request: FastifyRequest<{ Params: { id: string; fileId: string } }>, reply: FastifyReply, attach: boolean) {
    if (!context.validateMutation(request, reply)) return reply;
    const dept = await department(request, reply);
    if (!dept) return reply;
    const { id, fileId } = request.params;
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, dept)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This location is read-only." });
      }
      const event = await client.query(`${activeLocalEvent} FOR SHARE`, [dept, id]);
      if (!event.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Active local event not found." });
      }
      const file = await client.query(`SELECT id FROM stored_files stored WHERE stored.department_id=$1 AND stored.id=$4
        AND stored.deleted_at IS NULL AND ${storedFileWikiAudienceSql} FOR SHARE OF stored`,
      [dept, canManageStoredFileWikiAudience(request), request.authenticatedUser!.id, fileId]);
      if (!file.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "File not found or unavailable." });
      }
      if (attach) await client.query(`INSERT INTO service_event_files(department_id,event_id,file_id,attached_by)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [dept, id, fileId, request.authenticatedUser!.id]);
      else await client.query("DELETE FROM service_event_files WHERE department_id=$1 AND event_id=$2 AND file_id=$3", [dept, id, fileId]);
      await client.query("COMMIT");
      return { attached: attach };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  app.put<{ Params: { id: string; fileId: string } }>("/api/events/:id/files/:fileId", { schema: { params: fileParams } },
    (request, reply) => changeAttachment(request, reply, true));
  app.delete<{ Params: { id: string; fileId: string } }>("/api/events/:id/files/:fileId", { schema: { params: fileParams } },
    (request, reply) => changeAttachment(request, reply, false));
}
