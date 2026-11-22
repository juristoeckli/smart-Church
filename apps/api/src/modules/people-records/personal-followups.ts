import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ModuleServerContext } from "../module-sdk.js";

const path = "/api/people-records/:contactId/personal-followups";
const uuid = { type: "string", format: "uuid" } as const;
const contactParams = { type: "object", required: ["contactId"], properties: { contactId: uuid } } as const;
const taskParams = { type: "object", required: ["contactId","taskId"], properties: { contactId: uuid, taskId: uuid } } as const;
const fields = {
  title: { type: "string", minLength: 1, maxLength: 160 },
  details: { type: "string", maxLength: 4000 },
  dueOn: { type: "string", format: "date", pattern: "^[1-9][0-9]{3}-" },
} as const;
type ContactParams = { contactId: string };
type TaskParams = ContactParams & { taskId: string };
type Draft = { title: string; details: string; dueOn: string };
type Task = Draft & { id: string; revision: number; completedAt: string | null };
type Update = { revision: number } & ({ action: "edit"; draft: Draft } | { action: "complete" | "reopen" });
type DepartmentResolver = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;

const projection = "id,title,details,to_char(due_on,'YYYY-MM-DD') AS \"dueOn\",revision,completed_at AS \"completedAt\"";
const normalized = (draft: Draft) => ({ ...draft, title: draft.title.trim(), details: draft.details.trim() });

export function registerPersonalFollowups(routes: FastifyInstance, context: ModuleServerContext, department: DepartmentResolver) {
  const { pool, validateMutation, lockDepartmentForWrite } = context;

  async function write(
    request: FastifyRequest<{ Params: ContactParams }>,
    reply: FastifyReply,
    apply: (client: PoolClient, departmentId: string, contactId: string, owner: string) => Promise<Task | null>,
    created: boolean,
  ) {
    const departmentId = await department(request, reply);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const owner = request.authenticatedUser!.id;
    const { contactId } = request.params;
    reply.header("Cache-Control", "private, no-store");
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const active = await client.query("SELECT id FROM contacts WHERE department_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE", [departmentId,contactId]);
      if (!active.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Active person not found at this location." });
      }
      const result = await apply(client,departmentId,contactId,owner);
      await client.query("COMMIT");
      return result ? reply.code(created ? 201 : 200).send(result)
        : reply.code(409).send({ error: "The follow-up is unavailable or changed. Refresh and try again." });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  routes.get<{ Params: ContactParams; Querystring: { completed?: boolean; page?: number } }>(path, {
    schema: { params: contactParams, querystring: { type: "object", additionalProperties: false, properties: {
      completed: { type: "boolean" }, page: { type: "integer", minimum: 1, maximum: 10000 },
    } } },
  }, async (request,reply) => {
    const departmentId = await department(request,reply);
    if (!departmentId) return reply;
    reply.header("Cache-Control","private, no-store");
    const { contactId } = request.params;
    const result = await pool!.query<{ tasks: Task[] }>(
      `SELECT COALESCE((SELECT jsonb_agg(task ORDER BY task."dueOn",task.id) FROM (
        SELECT ${projection} FROM people_personal_followups
        WHERE department_id=c.department_id AND contact_id=c.id AND owner_user_id=$3 AND (completed_at IS NOT NULL)=$4
        ORDER BY due_on,id LIMIT 26 OFFSET $5
      ) task),'[]') AS tasks FROM contacts c WHERE c.department_id=$1 AND c.id=$2 AND c.archived_at IS NULL`,
      [departmentId,contactId,request.authenticatedUser!.id,request.query.completed ?? false,((request.query.page ?? 1)-1) * 25],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: "Active person not found at this location." });
    const { tasks } = result.rows[0];
    return { tasks: tasks.slice(0,25), hasMore: tasks.length > 25 };
  });

  const draftSchema = { type: "object", additionalProperties: false, required: ["title","details","dueOn"], properties: fields } as const;
  routes.post<{ Params: ContactParams; Body: Draft }>(path, {
    schema: { params: contactParams, body: draftSchema },
  }, async (request,reply) => {
    const draft = normalized(request.body);
    if (!draft.title) return reply.code(400).send({ error: "Enter a follow-up title." });
    return write(request,reply,async (client,departmentId,contactId,owner) => {
      const result = await client.query<Task>(
        `INSERT INTO people_personal_followups(id,department_id,contact_id,owner_user_id,title,details,due_on)
         VALUES($1,$2,$3,$4,$5,$6,$7::date) RETURNING ${projection}`,
        [randomUUID(),departmentId,contactId,owner,draft.title,draft.details,draft.dueOn],
      );
      return result.rows[0];
    },true);
  });

  const revision = { type: "integer", minimum: 1, maximum: 2147483646 } as const;
  routes.patch<{ Params: TaskParams; Body: Update }>(path + "/:taskId", {
    schema: { params: taskParams, body: {
      type: "object", additionalProperties: false, required: ["revision","action"],
      properties: { revision, action: { type: "string", enum: ["edit","complete","reopen"] }, draft: draftSchema },
      if: { properties: { action: { const: "edit" } } },
      then: { required: ["draft"] },
    } },
  }, async (request,reply) => {
    const update = request.body;
    const draft = update.action === "edit" ? normalized(update.draft) : null;
    if (draft && !draft.title) return reply.code(400).send({ error: "Enter a follow-up title." });
    return write(request,reply,async (client,departmentId,contactId,owner) => {
      const condition = "department_id=$1 AND contact_id=$2 AND owner_user_id=$3 AND id=$4 AND revision=$5";
      const values = [departmentId,contactId,owner,request.params.taskId,update.revision];
      const statement = draft
        ? `UPDATE people_personal_followups SET title=$6,details=$7,due_on=$8::date,revision=revision+1 WHERE ${condition} AND completed_at IS NULL`
        : update.action === "complete"
          ? `UPDATE people_personal_followups SET completed_at=now(),revision=revision+1 WHERE ${condition} AND completed_at IS NULL`
          : `UPDATE people_personal_followups SET completed_at=NULL,revision=revision+1 WHERE ${condition} AND completed_at IS NOT NULL`;
      const result = await client.query<Task>(statement + " RETURNING " + projection,
        draft ? [...values,draft.title,draft.details,draft.dueOn] : values);
      return result.rows[0] ?? null;
    },false);
  });
}
