import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { maxPortraitBytes, isPortraitPng } from "./portrait-png.js";

import { canManagePeopleFields } from "./field-privacy.js";

export const maxPersonAttachments = 50;
const maxAttachmentBytes = 10 * 1024 * 1024;
const uploadType = "application/vnd.smart-church.person-attachment";
const attachmentPath = "/api/people-records/:contactId/attachments";
const portraitPath = "/api/people-records/:contactId/portrait";
const uuid = { type: "string", format: "uuid" } as const;
const contactParams = { type: "object", required: ["contactId"], additionalProperties: false, properties: { contactId: uuid } } as const;
const fileParams = { type: "object", required: ["contactId", "attachmentId"], additionalProperties: false, properties: { contactId: uuid, attachmentId: uuid } } as const;

export function filenameForUpload(value: string) {
  const basename = (value.split(/[/\\]/).at(-1) ?? "").replace(/[<>:"|?*\p{Cc}\p{Cf}]/gu, "_").trim();
  return !basename || /^\.+$/.test(basename) ? "attachment" : Array.from(basename).slice(0, 180).join("");
}

export function attachmentFilename(value: string) {
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

  routes.get<{ Params: { contactId: string } }>(portraitPath, { schema: { params: contactParams } }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    const { rows: [attachment] } = await pool!.query<{ file_data: Buffer }>(
      "SELECT file_data FROM people_record_attachments WHERE department_id=$1 AND contact_id=$2 AND is_portrait AND file_size<=$3 AND (NOT managers_only OR $4::boolean)",
      [departmentId, request.params.contactId, maxPortraitBytes, canManagePeopleFields(request)]);
    reply.header("cache-control", "private, no-store");
    if (!attachment) return reply.code(404).send({ error: "No portrait is selected." });
    return reply.type("image/png").header("x-content-type-options", "nosniff")
      .header("cross-origin-resource-policy", "same-origin").send(attachment.file_data);
  });

  routes.put<{ Params: { contactId: string }; Body: { attachmentId: string | null } }>(portraitPath, {
    schema: { params: contactParams, body: { type: "object", required: ["attachmentId"], additionalProperties: false,
      properties: { attachmentId: { type: ["string", "null"], format: "uuid" } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const { contactId } = request.params;
    const { attachmentId } = request.body;
    return changeAttachment(reply, departmentId, contactId, async (client) => {
      const { rows: [previous] } = await client.query<{ id: string; managers_only: boolean }>(
        "SELECT id,managers_only FROM people_record_attachments WHERE department_id=$1 AND contact_id=$2 AND is_portrait", [departmentId, contactId]);
      if (attachmentId === (previous?.id ?? null)) return { status: 200, payload: { attachmentId } };
      let nextRestricted = false;
      if (attachmentId) {
        const { rows: [attachment] } = await client.query<{ file_data: Buffer | null; managers_only: boolean }>(
          "SELECT CASE WHEN file_size<=$4 THEN file_data ELSE NULL END file_data,managers_only FROM people_record_attachments WHERE department_id=$1 AND contact_id=$2 AND id=$3",
          [departmentId, contactId, attachmentId, maxPortraitBytes]);
        if (!attachment) return { status: 404, payload: { error: "Attachment not found." } };
        nextRestricted = attachment.managers_only;
        if (!attachment.file_data || !isPortraitPng(attachment.file_data)) {
          return { status: 400, payload: { error: "Choose a supported PNG no larger than 2 MiB and 1 million pixels." } };
        }
      }
      await client.query("UPDATE people_record_attachments SET is_portrait=false WHERE department_id=$1 AND contact_id=$2 AND is_portrait", [departmentId, contactId]);
      if (attachmentId) await client.query("UPDATE people_record_attachments SET is_portrait=true WHERE department_id=$1 AND contact_id=$2 AND id=$3", [departmentId, contactId, attachmentId]);
      await client.query(
        "INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,before_value,after_value,managers_only) VALUES($1,$2,$3,$4,$5,'portrait',$6::jsonb,$7::jsonb,$8)",
        [randomUUID(), departmentId, contactId, request.authenticatedUser!.id, attachmentId ? "portrait_selected" : "portrait_removed",
          JSON.stringify(previous ? { attachmentId: previous.id } : null), JSON.stringify(attachmentId ? { attachmentId } : null), Boolean(previous?.managers_only || nextRestricted)]);
      return { status: 200, payload: { attachmentId } };
    });
  });

  routes.get<{ Params: { contactId: string } }>(attachmentPath, { schema: { params: contactParams } }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    const { contactId } = request.params;
    const person = await pool!.query("SELECT 1 FROM contacts WHERE department_id=$1 AND id=$2", [departmentId, contactId]);
    if (!person.rowCount) return reply.code(404).send({ error: "Person not found." });
    const result = await pool!.query(
      `SELECT file.id,file.file_name AS "fileName",file.file_size AS "fileSize",file.is_portrait AS "isPortrait",file.managers_only AS "managersOnly",file.created_at AS "uploadedAt",COALESCE(file.historical_actor_name,account.display_name) AS "uploadedBy"
         FROM people_record_attachments file LEFT JOIN app_users account ON account.id=file.uploaded_by
        WHERE file.department_id=$1 AND file.contact_id=$2 AND (NOT file.managers_only OR $3::boolean) ORDER BY file.created_at DESC,file.id`, [departmentId, contactId, canManagePeopleFields(request)],
    );
    return reply.header("cache-control", "private, no-store").send(result.rows);
  });

  routes.post<{ Params: { contactId: string }; Querystring: { filename: string; useAsPortrait?: boolean; managersOnly?: boolean }; Body: Buffer }>(attachmentPath, {
    bodyLimit: maxAttachmentBytes,
    schema: { params: contactParams, querystring: { type: "object", required: ["filename"], additionalProperties: false, properties: { filename: { type: "string", minLength: 1, maxLength: 255 }, useAsPortrait: { type: "boolean" }, managersOnly: { type: "boolean" } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const content = request.body;
    if (!Buffer.isBuffer(content) || !content.length) return reply.code(400).send({ error: "Choose a non-empty file to upload." });
    if (content.length > maxAttachmentBytes) return reply.code(413).send({ error: "Attachments must be 10 MiB or smaller." });
    const useAsPortrait = request.query.useAsPortrait === true;
    const restricted = request.query.managersOnly === true;
    if (useAsPortrait && !isPortraitPng(content)) {
      return reply.code(400).send({ error: "The portrait must be a supported PNG no larger than 2 MiB and 1 million pixels." });
    }
    const fileName = filenameForUpload(request.query.filename);
    const { contactId } = request.params;
    const actorId = request.authenticatedUser!.id;
    return changeAttachment(reply, departmentId, contactId, async (client) => {
      const { rows } = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM people_record_attachments WHERE department_id=$1 AND contact_id=$2", [departmentId, contactId]);
      if (rows[0].count >= maxPersonAttachments) return { status: 409, payload: { error: `A person can have up to ${maxPersonAttachments} attachments.` } };
      const id = randomUUID();
      let previousPortrait: { id: string; managers_only: boolean } | undefined;
      if (useAsPortrait) {
        const { rows: [previous] } = await client.query<{ id: string; managers_only: boolean }>(
          "UPDATE people_record_attachments SET is_portrait=false WHERE department_id=$1 AND contact_id=$2 AND is_portrait RETURNING id,managers_only",
          [departmentId, contactId],
        );
        previousPortrait = previous;
      }
      await client.query(
        "INSERT INTO people_record_attachments (id,department_id,contact_id,file_name,file_size,file_data,uploaded_by,is_portrait,managers_only) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [id, departmentId, contactId, fileName, content.length, content, actorId, useAsPortrait, restricted],
      );
      await client.query(
        "INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,after_value,managers_only) VALUES($1,$2,$3,$4,'attachment_added',$5,$6::jsonb,$7)",
        [randomUUID(), departmentId, contactId, actorId, id, JSON.stringify({ fileSize: content.length }), restricted],
      );
      if (useAsPortrait) {
        await client.query(
          "INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,before_value,after_value,managers_only) VALUES($1,$2,$3,$4,'portrait_selected','portrait',$5::jsonb,$6::jsonb,$7)",
          [randomUUID(), departmentId, contactId, actorId,
            JSON.stringify(previousPortrait ? { attachmentId: previousPortrait.id } : null), JSON.stringify({ attachmentId: id }),
            Boolean(previousPortrait?.managers_only || restricted)],
        );
      }
      return { status: 201, payload: { id } };
    });
  });

  routes.get<{ Params: { contactId: string; attachmentId: string } }>(`${attachmentPath}/:attachmentId`, { schema: { params: fileParams } }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    const { contactId, attachmentId } = request.params;
    const result = await pool!.query<{ file_name: string; file_data: Buffer }>(
      "SELECT file_name,file_data FROM people_record_attachments WHERE department_id=$1 AND contact_id=$2 AND id=$3 AND (NOT managers_only OR $4::boolean)", [departmentId, contactId, attachmentId, canManagePeopleFields(request)],
    );
    const file = result.rows[0];
    if (!file) return reply.code(404).send({ error: "Attachment not found." });
    return reply.type("application/octet-stream")
      .header("content-disposition", attachmentFilename(file.file_name))
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .send(file.file_data);
  });

  routes.patch<{ Params: { contactId: string; attachmentId: string }; Body: { managersOnly: boolean } }>(`${attachmentPath}/:attachmentId`, {
    schema: { params: fileParams, body: { type: "object", required: ["managersOnly"], additionalProperties: false,
      properties: { managersOnly: { type: "boolean" } } } },
  }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const { attachmentId, contactId } = request.params;
    const { managersOnly } = request.body;
    return changeAttachment(reply, departmentId, contactId, async (client) => {
      const args = [departmentId, contactId, attachmentId];
      const { rows: [current] } = await client.query<{ managers_only: boolean }>(
        "SELECT managers_only FROM people_record_attachments WHERE department_id=$1 AND contact_id=$2 AND id=$3", args);
      if (!current) return { status: 404, payload: { error: "Attachment not found." } };
      if (current.managers_only === managersOnly) return { status: 200, payload: { managersOnly } };
      await client.query("UPDATE people_record_attachments SET managers_only=$4 WHERE department_id=$1 AND contact_id=$2 AND id=$3",
        [...args, managersOnly]);
      if (managersOnly) {
        // Hide previous attachment and portrait metadata as well as the binary.
        await client.query(`UPDATE people_record_history SET managers_only=true
          WHERE department_id=$1 AND contact_id=$2 AND (
            (action IN ('attachment_added','attachment_removed') AND subject=$3)
            OR (subject='portrait' AND (before_value->>'attachmentId'=$3 OR after_value->>'attachmentId'=$3))
          )`, args);
      }
      await client.query(`INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,before_value,after_value,managers_only)
        VALUES($1,$2,$3,$4,'attachment_access_changed',$5,$6::jsonb,$7::jsonb,true)`,
      [randomUUID(), departmentId, contactId, request.authenticatedUser!.id, attachmentId,
        JSON.stringify({ managersOnly: current.managers_only }), JSON.stringify({ managersOnly })]);
      return { status: 200, payload: { managersOnly } };
    });
  });

  routes.delete<{ Params: { contactId: string; attachmentId: string } }>(`${attachmentPath}/:attachmentId`, { schema: { params: fileParams } }, async (request, reply) => {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const { attachmentId, contactId } = request.params;
    return changeAttachment(reply, departmentId, contactId, async (client) => {
      const result = await client.query<{ file_size: number; managers_only: boolean }>(
        "DELETE FROM people_record_attachments WHERE department_id=$1 AND contact_id=$2 AND id=$3 RETURNING file_size,managers_only", [departmentId, contactId, attachmentId],
      );
      if (!result.rows[0]) return { status: 404, payload: { error: "Attachment not found." } };
      await client.query(
        "INSERT INTO people_record_history(id,department_id,contact_id,actor_user_id,action,subject,before_value,managers_only) VALUES($1,$2,$3,$4,'attachment_removed',$5,$6::jsonb,$7)",
        [randomUUID(), departmentId, contactId, request.authenticatedUser!.id, attachmentId, JSON.stringify({ fileSize: result.rows[0].file_size }), result.rows[0].managers_only],
      );
      return { status: 200, payload: { deleted: true } };
    });
  });
}
