import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

export const maxPersonAttachments = 50;
const maxAttachmentBytes = 10 * 1024 * 1024;
const uploadType = "application/vnd.smart-church.person-attachment";
const attachmentPath = "/api/people-records/:contactId/attachments";
const uuid = { type: "string", format: "uuid" } as const;
const contactParams = { type: "object", required: ["contactId"], additionalProperties: false, properties: { contactId: uuid } } as const;
const fileParams = { type: "object", required: ["contactId", "attachmentId"], additionalProperties: false, properties: { contactId: uuid, attachmentId: uuid } } as const;

function filenameForUpload(value: string) {
  const basename = (value.split(/[/\\]/).at(-1) ?? "").replace(/[<>:"|?*\p{Cc}\p{Cf}]/gu, "_").trim();
  return !basename || /^\.+$/.test(basename) ? "attachment" : Array.from(basename).slice(0, 180).join("");
}

function attachmentFilename(value: string) {
  return "attachment; filename*=UTF-8''" + encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

type DepartmentResolver = (request: FastifyRequest, reply: FastifyReply, write?: boolean) => Promise<string | null>;

export function registerPersonAttachments(routes: FastifyInstance, context: ModuleServerContext, department: DepartmentResolver) {
  const { pool, validateMutation, lockDepartmentForWrite, realtime } = context;
  routes.addContentTypeParser(uploadType, { parseAs: "buffer", bodyLimit: maxAttachmentBytes }, (_request, body, done) => done(null, body));

  async function changeAttachment(reply: FastifyReply, departmentId: string, contactId: string, apply: (client: PoolClient) => Promise<{ status: number; payload: object }>) {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const person = await client.query<{ archived_at: Date | null }>("SELECT archived_at FROM contacts WHERE department_id=$1 AND id=$2 FOR UPDATE", [departmentId, contactId]);
      if (!person.rows[0] || person.rows[0].archived_at) {
        await client.query("ROLLBACK");
        return person.rows[0] ? reply.code(409).send({ error: "Restore this person before changing their attachments." }) : reply.code(404).send({ error: "Person not found." });
      }
      const result = await apply(client);
      await client.query("COMMIT");
      if (result.status < 400) realtime.publish("people-records:changed", departmentId, { contactId });
      return reply.code(result.status).send(result.payload);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  routes.get<{ Params: { contactId: string } }>(attachmentPath, { schema: { params: contactParams } }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    const { contactId } = request.params;
    const person = await pool!.query("SELECT 1 FROM contacts WHERE department_id=$1 AND id=$2", [departmentId, contactId]);
    if (!person.rowCount) return reply.code(404).send({ error: "Person not found." });
    const result = await pool!.query(
      `SELECT file.id,file.file_name AS "fileName",file.file_size AS "fileSize",file.created_at AS "uploadedAt",account.display_name AS "uploadedBy"
         FROM people_record_attachments file LEFT JOIN app_users account ON account.id=file.uploaded_by
        WHERE file.department_id=$1 AND file.contact_id=$2 ORDER BY file.created_at DESC,file.id`, [departmentId, contactId],
    );
    return reply.header("cache-control", "private, no-store").send(result.rows);
  });

  routes.post<{ Params: { contactId: string }; Querystring: { filename: string }; Body: Buffer }>(attachmentPath, {
    bodyLimit: maxAttachmentBytes,
    schema: { params: contactParams, querystring: { type: "object", required: ["filename"], additionalProperties: false, properties: { filename: { type: "string", minLength: 1, maxLength: 255 } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const content = request.body;
    if (!Buffer.isBuffer(content) || !content.length) return reply.code(400).send({ error: "Choose a non-empty file to upload." });
    if (content.length > maxAttachmentBytes) return reply.code(413).send({ error: "Attachments must be 10 MiB or smaller." });
    const fileName = filenameForUpload(request.query.filename);
    const { contactId } = request.params;
    const actorId = request.authenticatedUser!.id;
    return changeAttachment(reply, departmentId, contactId, async (client) => {
      const { rows } = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM people_record_attachments WHERE department_id=$1 AND contact_id=$2", [departmentId, contactId]);
      if (rows[0].count >= maxPersonAttachments) return { status: 409, payload: { error: `A person can have up to ${maxPersonAttachments} attachments.` } };
      const id = randomUUID();
      await client.query(
        "INSERT INTO people_record_attachments (id,department_id,contact_id,file_name,file_size,file_data,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id, departmentId, contactId, fileName, content.length, content, actorId],
      );
      await client.query(
        "INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,after_value) VALUES($1,$2,$3,$4,'attachment_added',$5,$6::jsonb)",
        [randomUUID(), departmentId, contactId, actorId, id, JSON.stringify({ fileSize: content.length })],
      );
      return { status: 201, payload: { id } };
    });
  });

  routes.get<{ Params: { contactId: string; attachmentId: string } }>(`${attachmentPath}/:attachmentId`, { schema: { params: fileParams } }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    const { contactId, attachmentId } = request.params;
    const result = await pool!.query<{ file_name: string; file_data: Buffer }>(
      "SELECT file_name,file_data FROM people_record_attachments WHERE department_id=$1 AND contact_id=$2 AND id=$3", [departmentId, contactId, attachmentId],
    );
    const file = result.rows[0];
    if (!file) return reply.code(404).send({ error: "Attachment not found." });
    return reply.type("application/octet-stream")
      .header("content-disposition", attachmentFilename(file.file_name))
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .send(file.file_data);
  });

  routes.delete<{ Params: { contactId: string; attachmentId: string } }>(`${attachmentPath}/:attachmentId`, { schema: { params: fileParams } }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const { attachmentId, contactId } = request.params;
    return changeAttachment(reply, departmentId, contactId, async (client) => {
      const result = await client.query<{ file_size: number }>(
        "DELETE FROM people_record_attachments WHERE department_id=$1 AND contact_id=$2 AND id=$3 RETURNING file_size", [departmentId, contactId, attachmentId],
      );
      if (!result.rows[0]) return { status: 404, payload: { error: "Attachment not found." } };
      await client.query(
        "INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,before_value) VALUES($1,$2,$3,$4,'attachment_removed',$5,$6::jsonb)",
        [randomUUID(), departmentId, contactId, request.authenticatedUser!.id, attachmentId, JSON.stringify({ fileSize: result.rows[0].file_size })],
      );
      return { status: 200, payload: { deleted: true } };
    });
  });
}
