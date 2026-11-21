import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

const base = "/api/modules/group-hierarchy/groups/:groupId/member-fields";
const uuid = { type: "string", format: "uuid" } as const;
const groupParams = { type: "object", required: ["groupId"], additionalProperties: false, properties: { groupId: uuid } } as const;
const memberParams = { type: "object", required: ["groupId", "contactId"], additionalProperties: false, properties: { groupId: uuid, contactId: uuid } } as const;
const types = ["text", "number", "boolean", "date", "select"] as const;
type FieldType = typeof types[number];
type Field = { id: string; label: string; type: FieldType; options: string[] };
type Scope = { departmentId: string; groupId: string };
type ManagerCheck = (request: FastifyRequest, groupId: string, departmentId: string, db?: Pick<PoolClient, "query">) => Promise<boolean>;

function normalizedValue(field: Field, value: unknown) {
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
      "SELECT id,label,field_type AS type,options FROM group_member_field_definitions WHERE department_id=$1 AND group_id=$2 ORDER BY created_at,id",
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

  app.post<{ Params: { groupId: string }; Body: { label: string; type: FieldType; options?: string[] } }>(base, {
    schema: { params: groupParams, body: { type: "object", additionalProperties: false, required: ["label", "type"], properties: {
      label: { type: "string", minLength: 1, maxLength: 80 },
      type: { type: "string", enum: types },
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
    const field = { id: randomUUID(), label, type, options };
    await client.query(
      "INSERT INTO group_member_field_definitions(id,department_id,group_id,label,field_type,options,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",
      [field.id, location.departmentId, location.groupId, label, type, JSON.stringify(options), request.authenticatedUser!.id],
    );
    return field;
  }, 201));

  app.get<{ Params: { groupId: string; contactId: string } }>(`${base}/:contactId`, { schema: { params: memberParams } }, async (request, reply) => {
    const location = await scope(request, reply);
    if (!location || !await checkGroup(request, reply, location, pool!)) return reply;
    const contactId = request.params.contactId;
    if (!await membership(pool!, location, contactId)) return reply.code(404).send({ error: "Group membership not found." });
    const result = await pool!.query<{ values: Record<string, unknown>; revision: number }>(
      'SELECT field_values AS values,revision FROM group_member_field_answers WHERE department_id=$1 AND group_id=$2 AND contact_id=$3',
      [location.departmentId, location.groupId, contactId],
    );
    return reply.header("cache-control", "private, no-store").send(result.rows[0] ?? { values: {}, revision: 0 });
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
