import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

type CalendarScope = "community" | "group" | "personal";
type TemplateInput = {
  name: string; title: string; subtitle?: string; description?: string; place?: string; url?: string;
  internalOnly?: boolean; tags?: string[];
};
type CalendarAuthorization = (request: FastifyRequest, scope: CalendarScope, ownerId: string | null) => boolean;
const uuid = { type: "string", format: "uuid" };
const calendarParams = { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } };
const templateParams = { type: "object", additionalProperties: false, required: ["id", "templateId"], properties: { id: uuid, templateId: uuid } };
const bodySchema = { type: "object", additionalProperties: false, required: ["name", "title"], properties: {
  name: { type: "string", minLength: 1, maxLength: 120 }, title: { type: "string", minLength: 1, maxLength: 160 },
  subtitle: { type: "string", maxLength: 240 }, description: { type: "string", maxLength: 8000 },
  place: { type: "string", maxLength: 200 }, url: { type: "string", maxLength: 1000 },
  internalOnly: { type: "boolean" }, tags: { type: "array", maxItems: 30, items: { type: "string", maxLength: 40 } },
} };
const fields = `id,name,title,subtitle,description,place,url,internal_only AS "internalOnly",tags`;
function templateValues(input: TemplateInput) {
  const name = input.name.trim();
  const title = input.title.trim();
  const url = input.url?.trim() ?? "";
  if (!name || !title) return null;
  if (url) {
    try {
      const target = new URL(url);
      if (!/^https?:\/\//i.test(url) || target.username || target.password || /[\x00-\x20\x7f]/.test(url)) return null;
    } catch { return null; }
  }
  const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  return [name, title, input.subtitle?.trim() ?? "", input.description?.trim() ?? "", input.place?.trim() ?? "",
    url, input.internalOnly === true, tags];
}

export function registerAppointmentTemplates(app: FastifyInstance, context: ModuleServerContext, canManage: CalendarAuthorization) {
  async function scope(request: FastifyRequest, reply: FastifyReply) {
    reply.header("Cache-Control", "private, no-store");
    if (!context.pool || !context.isDatabaseReady()) {
      reply.code(503).send({ error: "Calendar templates are unavailable." });
      return null;
    }
    return context.resolveDepartmentId(request, reply);
  }

  async function authorize(db: Pick<PoolClient, "query">, request: FastifyRequest, reply: FastifyReply, departmentId: string, id: string, lock = false) {
    const result = await db.query<{ scope: CalendarScope; owner_user_id: string | null }>(`SELECT scope,owner_user_id
      FROM church_calendar_calendars WHERE department_id=$1 AND id=$2 AND archived_at IS NULL${lock ? " FOR SHARE" : ""}`, [departmentId, id]);
    const calendar = result.rows[0];
    if (!calendar || !canManage(request, calendar.scope, calendar.owner_user_id)) {
      reply.code(404).send({ error: "Editable calendar not found." });
      return false;
    }
    return true;
  }

  app.get<{ Params: { id: string } }>("/api/modules/church-calendar/calendars/:id/appointment-templates", {
    schema: { params: calendarParams },
  }, async (request, reply) => {
    const dept = await scope(request, reply);
    if (!dept || !await authorize(context.pool!, request, reply, dept, request.params.id)) return reply;
    const result = await context.pool!.query(`SELECT ${fields} FROM church_calendar_appointment_templates
      WHERE department_id=$1 AND calendar_id=$2 ORDER BY lower(name),id`, [dept, request.params.id]);
    return result.rows;
  });

  async function write(
    request: FastifyRequest, reply: FastifyReply, id: string,
    mutation: (client: PoolClient, dept: string) => Promise<{ status: number; body: unknown }>,
  ) {
    if (!context.validateMutation(request, reply)) return reply;
    const dept = await scope(request, reply);
    if (!dept) return reply;
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, dept)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This location is read-only." });
      }
      if (!await authorize(client, request, reply, dept, id, true)) { await client.query("ROLLBACK"); return reply; }
      const { status, body } = await mutation(client, dept);
      await client.query(status < 400 ? "COMMIT" : "ROLLBACK");
      return reply.code(status).send(body);
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string } | null)?.code === "23505") return reply.code(409).send({ error: "A template with this name already exists in this calendar." });
      throw error;
    } finally { client.release(); }
  }

  app.post<{ Params: { id: string }; Body: TemplateInput }>("/api/modules/church-calendar/calendars/:id/appointment-templates", {
    schema: { params: calendarParams, body: bodySchema },
  }, (request, reply) => write(request, reply, request.params.id, async (db, dept) => {
    const values = templateValues(request.body);
    if (!values) return { status: 400, body: { error: "Enter the template name and appointment title, with a valid HTTP(S) link if needed." } };
    const stored = await db.query(`INSERT INTO church_calendar_appointment_templates
      (id,department_id,calendar_id,name,title,subtitle,description,place,url,internal_only,tags)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${fields}`, [randomUUID(), dept, request.params.id, ...values]);
    return { status: 201, body: stored.rows[0] };
  }));

  app.put<{ Params: { id: string; templateId: string }; Body: TemplateInput }>("/api/modules/church-calendar/calendars/:id/appointment-templates/:templateId", {
    schema: { params: templateParams, body: bodySchema },
  }, (request, reply) => write(request, reply, request.params.id, async (db, dept) => {
    const values = templateValues(request.body);
    if (!values) return { status: 400, body: { error: "Enter the template name and appointment title, with a valid HTTP(S) link if needed." } };
    const stored = await db.query(`UPDATE church_calendar_appointment_templates SET name=$4,title=$5,subtitle=$6,
      description=$7,place=$8,url=$9,internal_only=$10,tags=$11 WHERE department_id=$1 AND calendar_id=$2 AND id=$3
      RETURNING ${fields}`, [dept, request.params.id, request.params.templateId, ...values]);
    if (!stored.rows[0]) return { status: 404, body: { error: "Appointment template not found." } };
    return { status: 200, body: stored.rows[0] };
  }));

  app.delete<{ Params: { id: string; templateId: string } }>("/api/modules/church-calendar/calendars/:id/appointment-templates/:templateId", {
    schema: { params: templateParams },
  }, (request, reply) => write(request, reply, request.params.id, async (db, dept) => {
    const stored = await db.query("DELETE FROM church_calendar_appointment_templates WHERE department_id=$1 AND calendar_id=$2 AND id=$3",
      [dept, request.params.id, request.params.templateId]);
    if (!stored.rowCount) return { status: 404, body: { error: "Appointment template not found." } };
    return { status: 200, body: { deleted: true } };
  }));
}
