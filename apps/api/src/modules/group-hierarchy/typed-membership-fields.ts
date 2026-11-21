import { randomUUID } from "node:crypto";
import { csvDocument } from "../../csv-export.js";
import { createWorkbook } from "../finance/workbook.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

const base = "/api/modules/group-hierarchy/groups/:groupId/member-fields";
const uuid = { type: "string", format: "uuid" } as const;
const groupParams = { type: "object", required: ["groupId"], additionalProperties: false, properties: { groupId: uuid } } as const;
const memberParams = { type: "object", required: ["groupId", "contactId"], additionalProperties: false, properties: { groupId: uuid, contactId: uuid } } as const;
const definitionParams = { type: "object", required: ["groupId", "fieldId"], additionalProperties: false, properties: { groupId: uuid, fieldId: uuid } } as const;
const labelSchema = { type: "string", minLength: 1, maxLength: 80 } as const;
const definitionColumns = 'id,label,field_type AS type,options,revision,archived_at AS "archivedAt",default_value AS "defaultValue"';
const types = ["text", "number", "boolean", "date", "select"] as const;
type FieldType = typeof types[number];
type Value = string | number | boolean;
type Field = { id: string; label: string; type: FieldType; options: string[]; revision: number; archivedAt: Date | null; defaultValue: Value | null };
type Scope = { departmentId: string; groupId: string };
type ManagerCheck = (request: FastifyRequest, groupId: string, departmentId: string, db?: Pick<PoolClient, "query">) => Promise<boolean>;

function normalizedValue(field: Pick<Field, "type" | "options">, value: unknown) {
  if (value === null) return null;
  if (field.type === "boolean") return typeof value === "boolean" ? value : undefined;
  if (field.type === "number") return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.includes("\u0000")) return undefined;
  const text = value.trim();
  if (field.type === "text") return text.length <= 500 ? text || null : undefined;
  if (field.type === "select") return field.options.includes(text) ? text : undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith("0000-")) return undefined;
  const date = new Date(text + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : undefined;
}

export function registerTypedMembershipFields(app: FastifyInstance, context: ModuleServerContext, canManageGroup: ManagerCheck) {
  const { pool, isDatabaseReady, validateMutation, resolveDepartmentId, lockDepartmentForWrite } = context;

  async function scope(request: FastifyRequest<{ Params: { groupId: string } }>, reply: FastifyReply) {
    if (!pool || !isDatabaseReady()) { reply.code(503).send({ error: "Group administration is unavailable." }); return null; }
    const departmentId = await resolveDepartmentId(request, reply);
    return departmentId ? { departmentId, groupId: request.params.groupId } : null;
  }

  async function checkGroup(request: FastifyRequest, reply: FastifyReply, { departmentId, groupId }: Scope, db: Pick<PoolClient, "query">, write = false) {
    const group = await db.query<{ source_system: string | null }>(
      `SELECT source_system FROM church_groups g WHERE g.department_id=$1 AND g.id=$2
        AND to_jsonb(g)->>'archived_at' IS NULL ${write ? "FOR UPDATE" : ""}`, [departmentId, groupId],
    );
    if (!group.rowCount) { reply.code(404).send({ error: "Group not found." }); return false; }
    if (!await canManageGroup(request, groupId, departmentId, db)) { reply.code(403).send({ error: "Group management access is required." }); return false; }
    if (group.rows[0].source_system === "churchtools" || group.rows[0].source_system === "elvanto") {
      reply.code(403).send({ error: "This group is managed by an external sync." });
      return false;
    }
    return true;
  }

  async function definitions(db: Pick<PoolClient, "query">, { departmentId, groupId }: Scope) {
    const result = await db.query<Field>(
      `SELECT ${definitionColumns} FROM group_member_field_definitions WHERE department_id=$1 AND group_id=$2 ORDER BY created_at,id`,
      [departmentId, groupId],
    );
    return result.rows;
  }

  async function membership(db: Pick<PoolClient, "query">, { departmentId, groupId }: Scope, contactId: string, write = false) {
    const result = await db.query(
      `SELECT 1 FROM group_members member JOIN contacts person ON person.id=member.contact_id AND person.department_id=$1
        WHERE member.group_id=$2 AND member.contact_id=$3 ${write ? "AND person.archived_at IS NULL FOR UPDATE OF member,person" : ""}`,
      [departmentId, groupId, contactId],
    );
    return Boolean(result.rowCount);
  }

  async function change(
    request: FastifyRequest<{ Params: { groupId: string } }>, reply: FastifyReply,
    apply: (client: PoolClient, location: Scope) => Promise<object | null>, status: number,
  ) {
    if (!validateMutation(request, reply)) return reply;
    const location = await scope(request, reply);
    if (!location) return reply;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, location.departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      if (!await checkGroup(request, reply, location, client, true)) { await client.query("ROLLBACK"); return reply; }
      const result = await apply(client, location);
      if (!result) { await client.query("ROLLBACK"); return reply; }
      await client.query("COMMIT");
      return reply.code(status).send(result);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  app.get<{ Params: { groupId: string } }>(base, { schema: { params: groupParams } }, async (request, reply) => {
    const location = await scope(request, reply);
    if (!location || !await checkGroup(request, reply, location, pool!)) return reply;
    return reply.header("cache-control", "private, no-store").send(await definitions(pool!, location));
  });

  async function insertDefinition(client: PoolClient, location: Scope, actorId: string, input: Pick<Field, "label" | "type" | "options" | "defaultValue">): Promise<Field> {
    const { label, type, options, defaultValue } = input;
    const id = randomUUID();
    await client.query(
      "INSERT INTO group_member_field_definitions(id,department_id,group_id,label,field_type,options,created_by,default_value) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)",
      [id, location.departmentId, location.groupId, label, type, JSON.stringify(options), actorId, defaultValue === null ? null : JSON.stringify(defaultValue)],
    );
    return { id, ...input, revision: 1, archivedAt: null };
  }

  app.post<{ Params: { groupId: string }; Body: { label: string; type: FieldType; options?: string[]; defaultValue?: unknown } }>(base, {
    schema: { params: groupParams, body: { type: "object", additionalProperties: false, required: ["label", "type"], properties: {
      label: labelSchema,
      type: { type: "string", enum: types },
      defaultValue: {},
      options: { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 80 } },
    } } },
  }, async (request, reply) => change(request, reply, async (client, location) => {
    const label = request.body.label.trim();
    const { type } = request.body;
    const options = (request.body.options ?? []).map(option => option.trim());
    if (!label || label.includes("\u0000") || options.some(option => !option || option.includes("\u0000"))
      || new Set(options).size !== options.length || (type === "select") !== (options.length > 0)) {
      reply.code(400).send({ error: "Enter a field label and, for a choice field, one or more different options." }); return null;
    }
    const previous = await definitions(client, location);
    if (previous.length >= 40 || previous.some(field => field.label.toLowerCase() === label.toLowerCase())) {
      reply.code(409).send({ error: "A group can have up to 40 fields with unique labels." }); return null;
    }
    const defaultValue = normalizedValue({ type, options }, request.body.defaultValue ?? null);
    if (defaultValue === undefined) { reply.code(400).send({ error: "Enter a valid default for this field type." }); return null; }
    return insertDefinition(client, location, request.authenticatedUser!.id, { label, type, options, defaultValue });
  }, 201));

  app.post<{ Params: { groupId: string; fieldId: string }; Body: { label: string; revision: number } }>(`${base}/definitions/:fieldId/duplicate`, {
    schema: { params: definitionParams, body: {
      type: "object", additionalProperties: false, required: ["label", "revision"],
      properties: { label: labelSchema, revision: { type: "integer", minimum: 1, maximum: 2147483646 } },
    } },
  }, async (request, reply) => change(request, reply, async (client, location) => {
    const label = request.body.label.trim();
    if (!label || label.includes("\u0000")) { reply.code(400).send({ error: "Enter a valid membership field label." }); return null; }
    const fields = await definitions(client, location);
    const source = fields.find(field => field.id === request.params.fieldId.toLowerCase());
    if (!source) { reply.code(404).send({ error: "Membership field not found." }); return null; }
    if (source.archivedAt || source.revision !== request.body.revision) {
      reply.code(409).send({ error: "The source field changed or was archived. Reload the fields before duplicating it." }); return null;
    }
    if (fields.length >= 40 || fields.some(field => field.label.toLowerCase() === label.toLowerCase())) {
      reply.code(409).send({ error: "A group can have up to 40 fields with unique labels." }); return null;
    }
    return insertDefinition(client, location, request.authenticatedUser!.id,
      { label, type: source.type, options: source.options, defaultValue: source.defaultValue });
  }, 201));

  app.patch<{ Params: { groupId: string; fieldId: string }; Body: { revision: number; label?: string; archived?: boolean; defaultValue?: unknown } }>(`${base}/definitions/:fieldId`, {
    schema: {
      params: definitionParams,
      body: {
        type: "object", additionalProperties: false, required: ["revision"],
        oneOf: [{ required: ["label"] }, { required: ["archived"] }, { required: ["defaultValue"] }],
        properties: { revision: { type: "integer", minimum: 1, maximum: 2147483646 }, label: labelSchema, archived: { type: "boolean" }, defaultValue: {} },
      },
    },
  }, async (request, reply) => change(request, reply, async (client, location) => {
    const { fieldId } = request.params;
    const fields = await definitions(client, location);
    const field = fields.find(item => item.id === fieldId.toLowerCase());
    if (!field) { reply.code(404).send({ error: "Membership field not found." }); return null; }
    if (field.revision !== request.body.revision) {
      reply.code(409).send({ error: "This membership field changed. Reload the settings and try again." }); return null;
    }

    const label = request.body.label?.trim() ?? field.label;
    if (!label || label.includes("\u0000")) { reply.code(400).send({ error: "Enter a valid membership field label." }); return null; }
    if ((request.body.label !== undefined || request.body.defaultValue !== undefined) && field.archivedAt) {
      reply.code(409).send({ error: "Restore this membership field before editing it." }); return null;
    }
    if (fields.some(item => item.id !== field.id && item.label.toLowerCase() === label.toLowerCase())) {
      reply.code(409).send({ error: "This label is already used by a membership field, including archived fields." }); return null;
    }
    const archived = request.body.archived ?? Boolean(field.archivedAt);
    const defaultValue = request.body.defaultValue === undefined ? field.defaultValue : normalizedValue(field, request.body.defaultValue);
    if (defaultValue === undefined) { reply.code(400).send({ error: "Enter a valid default for this field type." }); return null; }
    if (field.label === label && Boolean(field.archivedAt) === archived && field.defaultValue === defaultValue) return field;

    const changed = await client.query<Field>(
      `UPDATE group_member_field_definitions
          SET label=$4,revision=revision+1,updated_at=now(),updated_by=$6,default_value=$7::jsonb,
              archived_at=CASE WHEN $5 THEN COALESCE(archived_at,now()) ELSE NULL END
        WHERE department_id=$1 AND group_id=$2 AND id=$3
        RETURNING ${definitionColumns}`,
      [location.departmentId, location.groupId, field.id, label, archived, request.authenticatedUser!.id, defaultValue === null ? null : JSON.stringify(defaultValue)],
    );
    return changed.rows[0];
  }, 200));

  const bulkContactIds = { type: "array", items: uuid, minItems: 1, maxItems: 100, uniqueItems: true } as const;
  const revisionSchema = { type: "integer", minimum: 0, maximum: 2147483646 } as const;
  const bulkFields = {
    fieldId: uuid, fieldRevision: { ...revisionSchema, minimum: 1 },
    value: {},
  } as const;
  type BulkChange = { fieldId: string; fieldRevision: number; value: unknown };
  type MemberVersion = { contactId: string; revision: number };
  type BulkRow = MemberVersion & { value: unknown };

  async function prepareBulkChange(client: PoolClient, location: Scope, reply: FastifyReply, input: BulkChange, contactIds: string[]) {
    const field = (await definitions(client, location)).find(item => item.id === input.fieldId.toLowerCase());
    if (!field || field.archivedAt || field.revision !== input.fieldRevision) {
      reply.code(409).send({ error: "This field is unavailable or changed. Reload the member fields and try again." }); return null;
    }
    const value = normalizedValue(field, input.value);
    if (value === undefined || (value === null && input.value !== null)) {
      reply.code(400).send({ error: `Enter a valid value for ${field.label} or choose Clear value.` }); return null;
    }
    const normalizedIds = contactIds.map(id => id.toLowerCase());
    if (new Set(normalizedIds).size !== normalizedIds.length) {
      reply.code(400).send({ error: "Select each group membership only once." }); return null;
    }
    const result = await client.query<BulkRow>(
      `SELECT member.contact_id AS "contactId",COALESCE(answer.revision,0) AS revision,answer.field_values->($4::text) AS value
         FROM group_members member JOIN contacts person ON person.id=member.contact_id AND person.department_id=$1
         LEFT JOIN group_member_field_answers answer ON answer.department_id=$1 AND answer.group_id=$2 AND answer.contact_id=member.contact_id
        WHERE member.group_id=$2 AND member.contact_id=ANY($3::uuid[]) AND person.archived_at IS NULL
        ORDER BY member.contact_id FOR UPDATE OF member,person`,
      [location.departmentId, location.groupId, normalizedIds, field.id],
    );
    if (result.rows.length !== normalizedIds.length) {
      reply.code(409).send({ error: "Some selected people are no longer active in this group. Refresh the roster and try again." }); return null;
    }
    return { field, value, rows: result.rows, changed: result.rows.filter(row => row.value !== value) };
  }

  app.post<{ Params: { groupId: string }; Body: BulkChange & { contactIds: string[] } }>(`${base}/bulk-preview`, {
    schema: { params: groupParams, body: { type: "object", additionalProperties: false,
      required: ["fieldId", "fieldRevision", "value", "contactIds"], properties: { ...bulkFields, contactIds: bulkContactIds },
    } },
  }, async (request, reply) => {
    reply.header("cache-control", "private, no-store");
    return change(request, reply, async (client, location) => {
      const preview = await prepareBulkChange(client, location, reply, request.body, request.body.contactIds);
      if (!preview) return null;
      return { fieldId: preview.field.id, fieldRevision: preview.field.revision, value: preview.value,
        members: preview.rows.map(({ contactId, revision }) => ({ contactId, revision })), changedCount: preview.changed.length };
    }, 200);
  });

  app.put<{ Params: { groupId: string }; Body: BulkChange & { members: MemberVersion[] } }>(`${base}/bulk-changes`, {
    schema: { params: groupParams, body: { type: "object", additionalProperties: false,
      required: ["fieldId", "fieldRevision", "value", "members"], properties: { ...bulkFields,
        members: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false,
          required: ["contactId", "revision"], properties: { contactId: uuid, revision: revisionSchema },
        } },
      },
    } },
  }, async (request, reply) => change(request, reply, async (client, location) => {
    const expected = new Map(request.body.members.map(member => [member.contactId.toLowerCase(), member.revision]));
    const patch = await prepareBulkChange(client, location, reply, request.body, request.body.members.map(member => member.contactId));
    if (!patch) return null;
    if (patch.rows.some(row => expected.get(row.contactId) !== row.revision)) {
      reply.code(409).send({ error: "Membership values changed after the preview. Preview the update again." }); return null;
    }
    if (patch.changed.length === 0) return { updated: 0 };
    const changed = await client.query(
      `INSERT INTO group_member_field_answers(department_id,group_id,contact_id,field_values,updated_by)
       SELECT $1,$2,selected.contact_id,jsonb_strip_nulls($4::jsonb),$5 FROM unnest($3::uuid[]) selected(contact_id)
       ON CONFLICT(department_id,group_id,contact_id) DO UPDATE
          SET field_values=jsonb_strip_nulls(group_member_field_answers.field_values || $4::jsonb),
              revision=group_member_field_answers.revision+1,updated_at=now(),updated_by=EXCLUDED.updated_by`,
      [location.departmentId, location.groupId, patch.changed.map(row => row.contactId),
        JSON.stringify({ [patch.field.id]: patch.value }), request.authenticatedUser!.id],
    );
    return { updated: changed.rowCount };
  }, 200));

  const rosterFieldIds = { type: "array", minItems: 1, maxItems: 8, uniqueItems: true, items: uuid } as const;
  const rosterColumnParams = {
    type: "object", additionalProperties: false, required: ["fieldId", "contactId"],
    properties: {
      fieldId: rosterFieldIds,
      contactId: { type: "array", minItems: 1, maxItems: 25, uniqueItems: true, items: uuid },
    },
  } as const;

  app.get<{ Params: { groupId: string }; Querystring: { fieldId: string[]; contactId: string[] } }>(`${base}/roster-values`, {
    schema: { params: groupParams, querystring: rosterColumnParams },
  }, async (request, reply) => {
    const location = await scope(request, reply);
    if (!location || !await checkGroup(request, reply, location, pool!)) return reply;
    const fieldIds = request.query.fieldId.map(id => id.toLowerCase());
    const contactIds = request.query.contactId.map(id => id.toLowerCase());
    if (new Set(fieldIds).size !== fieldIds.length || new Set(contactIds).size !== contactIds.length) {
      return reply.code(400).send({ error: "Select each roster field and member only once." });
    }
    const result = await pool!.query<{ activeFieldIds: string[]; members: unknown[] }>(
      `WITH selected_fields AS (
         SELECT id,default_value FROM group_member_field_definitions
          WHERE department_id=$1 AND group_id=$2 AND archived_at IS NULL AND id=ANY($3::uuid[])
       ), member_values AS (
         SELECT member.contact_id AS "contactId",
                COALESCE((
                  SELECT jsonb_object_agg(field.id,COALESCE(NULLIF(answer.field_values->(field.id::text),'null'::jsonb),field.default_value))
                    FROM selected_fields field
                ),'{}'::jsonb) AS values
           FROM group_members member JOIN contacts person ON person.id=member.contact_id AND person.department_id=$1
           LEFT JOIN group_member_field_answers answer ON answer.department_id=$1 AND answer.group_id=$2 AND answer.contact_id=member.contact_id
          WHERE member.group_id=$2 AND member.contact_id=ANY($4::uuid[]) AND person.archived_at IS NULL
       )
       SELECT ARRAY(SELECT id FROM selected_fields) AS "activeFieldIds",
              COALESCE((SELECT jsonb_agg(member_values) FROM member_values),'[]'::jsonb) AS members`,
      [location.departmentId, location.groupId, fieldIds, contactIds],
    );
    const data = result.rows[0];
    if (data.activeFieldIds.length !== fieldIds.length) {
      return reply.code(409).send({ error: "A selected field is no longer active in this group. Reload the fields and try again." });
    }
    return reply.header("cache-control", "private, no-store").send({ members: data.members });
  });

  const exportLimit = 2000;
  for (const format of ["csv", "xlsx"] as const) app.get<{ Params: { groupId: string }; Querystring: { fieldId?: string[] } }>(`${base}/export.${format}`, {
    schema: { params: groupParams, querystring: { type: "object", additionalProperties: false, properties: { fieldId: rosterFieldIds } } },
  }, async (request, reply) => {
    const location = await scope(request, reply);
    if (!location) return reply;
    const { departmentId, groupId } = location;
    const names = request.query.fieldId?.map(id => id.toLowerCase());
    const chosenIds = names && new Set(names);
    if (chosenIds && chosenIds.size !== names?.length) return reply.code(400).send({ error: "Select each membership field only once." });
    const client = await pool!.connect();
    let activeFields: Field[];
    let members: {
      firstName: string; lastName: string; role: string; status: string;
      fieldValues: Record<string, string | number | boolean>;
    }[];
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      if (!await checkGroup(request, reply, location, client)) { await client.query("ROLLBACK"); return reply; }
      activeFields = (await definitions(client, location)).filter(field => !field.archivedAt && (!chosenIds || chosenIds.has(field.id)));
      if (chosenIds && activeFields.length !== chosenIds.size) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "A selected field is no longer active in this group. Reload the fields and try again." });
      }
      const roster = await client.query<typeof members[number]>(
        `SELECT person.first_name AS "firstName",person.last_name AS "lastName",member.role,member.status,
                COALESCE((SELECT jsonb_object_agg(field.key,field.value) FROM jsonb_each(answer.field_values) field
                           WHERE field.key=ANY($3::text[])),'{}'::jsonb) AS "fieldValues"
           FROM group_members member JOIN contacts person ON person.id=member.contact_id AND person.department_id=$1
           LEFT JOIN group_member_field_answers answer ON answer.department_id=$1 AND answer.group_id=$2 AND answer.contact_id=member.contact_id
          WHERE member.group_id=$2 AND person.archived_at IS NULL
          ORDER BY lower(person.last_name),lower(person.first_name),person.id LIMIT $4`,
        [departmentId, groupId, activeFields.map(field => field.id), exportLimit + 1],
      );
      members = roster.rows;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    if (members.length > exportLimit) return reply.code(422).send({ error: `This export supports groups with up to ${exportLimit} roster members.` });
    const headers = ["First name", "Last name", "Membership role", "Membership status", ...activeFields.map(field => field.label)];
    const rows = members.map(member => [member.firstName, member.lastName, member.role, member.status, ...activeFields.map(field => member.fieldValues[field.id] ?? field.defaultValue)]);
    reply.header("Cache-Control", "private, no-store")
      .header("Content-Disposition", "attachment; filename=group-membership-fields." + format);
    return format === "xlsx"
      ? reply.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(createWorkbook("Report", headers, rows))
      : reply.type("text/csv; charset=utf-8").send(csvDocument(headers, rows));
  });

  app.get<{ Params: { groupId: string; contactId: string } }>(`${base}/:contactId`, { schema: { params: memberParams } }, async (request, reply) => {
    const location = await scope(request, reply);
    if (!location || !await checkGroup(request, reply, location, pool!)) return reply;
    const contactId = request.params.contactId;
    if (!await membership(pool!, location, contactId)) return reply.code(404).send({ error: "Group membership not found." });
    const result = await pool!.query<{ values: Record<string, unknown>; defaultedFieldIds: string[]; revision: number }>(
      `WITH current_answers AS (
          SELECT field_values,revision FROM group_member_field_answers WHERE department_id=$1 AND group_id=$2 AND contact_id=$3
        ), effective_fields AS (
          SELECT field.id,field.default_value,NULLIF(answer.field_values->(field.id::text),'null'::jsonb) AS stored
            FROM group_member_field_definitions field LEFT JOIN current_answers answer ON true
           WHERE field.department_id=$1 AND field.group_id=$2 AND field.archived_at IS NULL
        )
        SELECT COALESCE(jsonb_object_agg(id,COALESCE(stored,default_value))
                        FILTER (WHERE stored IS NOT NULL OR default_value IS NOT NULL),'{}'::jsonb) AS "values",
               COALESCE(array_agg(id ORDER BY id) FILTER (WHERE stored IS NULL AND default_value IS NOT NULL),'{}'::uuid[]) AS "defaultedFieldIds",
               COALESCE((SELECT revision FROM current_answers),0) AS revision
          FROM effective_fields`,
      [location.departmentId, location.groupId, contactId],
    );
    return reply.header("cache-control", "private, no-store").send(result.rows[0]);
  });

  app.put<{ Params: { groupId: string; contactId: string }; Body: { values: Record<string, unknown>; revision: number } }>(`${base}/:contactId`, {
    schema: { params: memberParams, body: { type: "object", additionalProperties: false, required: ["values", "revision"], properties: {
      revision: { type: "integer", minimum: 0, maximum: 2147483646 },
      values: { type: "object", minProperties: 1, maxProperties: 40 },
    } } },
  }, async (request, reply) => change(request, reply, async (client, location) => {
    const contactId = request.params.contactId;
    if (!await membership(client, location, contactId, true)) { reply.code(404).send({ error: "Active person or group membership not found." }); return null; }
    const fields = new Map((await definitions(client, location)).map(field => [field.id, field]));
    const patch: Record<string, string | number | boolean | null> = {};
    for (const [id, value] of Object.entries(request.body.values)) {
      const field = fields.get(id);
      if (field?.archivedAt) {
        reply.code(409).send({ error: "A membership field was archived. Reload the editor before saving." }); return null;
      }
      const normalized = field ? normalizedValue(field, value) : undefined;
      if (normalized === undefined) { reply.code(400).send({ error: field ? `Enter a valid value for ${field.label}.` : "A membership field does not belong to this group." }); return null; }
      patch[id] = normalized;
    }
    const args = [location.departmentId, location.groupId, contactId, JSON.stringify(patch), request.authenticatedUser!.id];
    const result = request.body.revision === 0
      ? await client.query(
        `INSERT INTO group_member_field_answers(department_id,group_id,contact_id,field_values,updated_by)
         VALUES($1,$2,$3,jsonb_strip_nulls($4::jsonb),$5) ON CONFLICT(department_id,group_id,contact_id) DO NOTHING RETURNING revision`, args,
      ) : await client.query(
        `UPDATE group_member_field_answers SET field_values=jsonb_strip_nulls(field_values || $4::jsonb),updated_by=$5,updated_at=now(),revision=revision+1
          WHERE department_id=$1 AND group_id=$2 AND contact_id=$3 AND revision=$6 RETURNING revision`, [...args, request.body.revision],
      );
    if (!result.rowCount) { reply.code(409).send({ error: "These membership fields changed. Reload the editor before saving again." }); return null; }
    return result.rows[0];
  }, 200));
}
