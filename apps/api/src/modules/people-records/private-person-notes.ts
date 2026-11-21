import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";
import { canManagePeopleFields } from "./field-privacy.js";

const path = "/api/people-records/:contactId/private-notes";
const uuid = { type: "string", format: "uuid" } as const;
const contactParams = { type: "object", additionalProperties: false, required: ["contactId"], properties: { contactId: uuid } } as const;
const noteParams = { type: "object", additionalProperties: false, required: ["contactId", "noteId"], properties: { contactId: uuid, noteId: uuid } } as const;
const bodyField = { type: "string", minLength: 1, maxLength: 4000 } as const;
const revisionField = { type: "integer", minimum: 1 } as const;
type DepartmentResolver = (request: FastifyRequest, reply: FastifyReply, write?: boolean) => Promise<string | null>;
type NoteParams = { contactId: string; noteId: string };

export function registerPrivatePersonNotes(routes: FastifyInstance, context: ModuleServerContext, department: DepartmentResolver) {
  const { pool, validateMutation, lockDepartmentForWrite } = context;

  async function changeNote(
    request: FastifyRequest<{ Params: { contactId: string } }>,
    reply: FastifyReply,
    apply: (client: PoolClient, departmentId: string, contactId: string, actorId: string) => Promise<boolean>,
    success: number,
  ) {
    const departmentId = await department(request, reply, true);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const { contactId } = request.params;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const person = await client.query<{ archived_at: Date | null }>(
        "SELECT archived_at FROM contacts WHERE department_id=$1 AND id=$2 FOR UPDATE", [departmentId, contactId],
      );
      if (!person.rows[0] || person.rows[0].archived_at) {
        await client.query("ROLLBACK");
        return person.rows[0]
          ? reply.code(409).send({ error: "Restore this person before changing their notes." })
          : reply.code(404).send({ error: "Person not found." });
      }
      const applied = await apply(client, departmentId, contactId, request.authenticatedUser!.id);
      if (!applied) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This note changed or is no longer available. Refresh the notes and try again." });
      }
      await client.query("COMMIT");
      return reply.code(success).send({ saved: true });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  routes.get<{ Params: { contactId: string }; Querystring: { archived?: boolean; offset?: number } }>(path, {
    schema: {
      params: contactParams,
      querystring: { type: "object", additionalProperties: false, properties: { archived: { type: "boolean" }, offset: { type: "integer", minimum: 0 } } },
    },
  }, async (request, reply) => {
    const departmentId = await department(request, reply);
    if (!departmentId) return reply;
    if (!canManagePeopleFields(request)) return reply.code(403).send({ error: "People management access is required to view private notes." });
    const { contactId } = request.params;
    const { archived = false, offset = 0 } = request.query;
    const person = await pool!.query("SELECT 1 FROM contacts WHERE department_id=$1 AND id=$2", [departmentId, contactId]);
    if (!person.rowCount) return reply.code(404).send({ error: "Person not found." });
    const notes = await pool!.query(
      `SELECT note.id,note.body,note.revision,note.created_at AS "createdAt",author.display_name AS "createdBy",
              note.edited_at AS "editedAt",editor.display_name AS "editedBy",
              note.archived_at AS "archivedAt",archiver.display_name AS "archivedBy"
         FROM people_record_private_notes note
         LEFT JOIN app_users author ON author.id=note.created_by
         LEFT JOIN app_users editor ON editor.id=note.edited_by
         LEFT JOIN app_users archiver ON archiver.id=note.archived_by
        WHERE note.department_id=$1 AND note.contact_id=$2 AND (note.archived_at IS NOT NULL)=$3
        ORDER BY note.created_at DESC,note.id DESC LIMIT 21 OFFSET $4`, [departmentId, contactId, archived, offset],
    );
    return reply.header("cache-control", "private, no-store").send({ notes: notes.rows.slice(0, 20), hasMore: notes.rows.length > 20 });
  });

  routes.post<{ Params: { contactId: string }; Body: { body: string } }>(path, {
    schema: { params: contactParams, body: { type: "object", additionalProperties: false, required: ["body"], properties: { body: bodyField } } },
  }, async (request, reply) => {
    const body = request.body.body.trim();
    if (!body || body.includes("\u0000")) return reply.code(400).send({ error: "Enter a valid note." });
    return changeNote(request, reply, async (client, departmentId, contactId, actorId) => {
      await client.query(
        "INSERT INTO people_record_private_notes(id,department_id,contact_id,body,created_by) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), departmentId, contactId, body, actorId],
      );
      return true;
    }, 201);
  });

  routes.put<{ Params: NoteParams; Body: { body: string; revision: number } }>(`${path}/:noteId`, {
    schema: { params: noteParams, body: { type: "object", additionalProperties: false, required: ["body", "revision"], properties: { body: bodyField, revision: revisionField } } },
  }, async (request, reply) => {
    const body = request.body.body.trim();
    if (!body || body.includes("\u0000")) return reply.code(400).send({ error: "Enter a valid note." });
    return changeNote(request, reply, async (client, departmentId, contactId, actorId) => {
      const result = await client.query(
        `UPDATE people_record_private_notes SET body=$6,revision=revision+1,edited_at=now(),edited_by=$5
          WHERE department_id=$1 AND contact_id=$2 AND id=$3 AND revision=$4 AND archived_at IS NULL`,
        [departmentId, contactId, request.params.noteId, request.body.revision, actorId, body],
      );
      return Boolean(result.rowCount);
    }, 200);
  });

  for (const action of ["archive", "restore"] as const) {
    routes.post<{ Params: NoteParams; Body: { revision: number } }>(`${path}/:noteId/${action}`, {
      schema: { params: noteParams, body: { type: "object", additionalProperties: false, required: ["revision"], properties: { revision: revisionField } } },
    }, async (request, reply) => changeNote(request, reply, async (client, departmentId, contactId, actorId) => {
      const result = await client.query(
        `UPDATE people_record_private_notes
            SET revision=revision+1,archived_at=CASE WHEN $6 THEN now() END,
                archived_by=CASE WHEN $6 THEN $5::uuid END
          WHERE department_id=$1 AND contact_id=$2 AND id=$3 AND revision=$4
            AND (archived_at IS NOT NULL)<>$6`,
        [departmentId, contactId, request.params.noteId, request.body.revision, actorId, action === "archive"],
      );
      return Boolean(result.rowCount);
    }, 200));
  }
}
