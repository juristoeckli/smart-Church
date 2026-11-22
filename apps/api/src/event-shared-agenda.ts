import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { ServicePlanItem } from "@smart-church/contracts";

type Dependencies = {
  pool: Pool | null;
  available: () => boolean;
  resolveScope: (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
  validateMutation: (request: FastifyRequest, reply: FastifyReply) => boolean;
  lockDepartmentForWrite: (client: PoolClient, departmentId: string) => Promise<boolean>;
};
type AgendaEvent = { source_system: string | null; cancelled_at: Date | null; recurrence_id: string | null;
  event_date: string; is_all_day: boolean; shared_agenda_source_id: string | null; items: number };
type Params = { id: string };
type Body = { sourceId: string | null; expectedSourceId: string | null };
const path = "/api/events/:id/shared-agenda";
type VisibilityParams = { id: string; itemId: string };
type VisibilityBody = { expectedSourceId: string; hidden: boolean };
type VisibilityRow = { sourceId: string; sourcePlan: ServicePlanItem[]; hiddenIds: string[] };
const visibilityPath = path + "/visibility";
const visibilityQuery = `SELECT source.id AS "sourceId",source.time_plan AS "sourcePlan",target.shared_agenda_hidden_item_ids AS "hiddenIds"
  FROM service_events target JOIN service_events source
    ON source.id=target.shared_agenda_source_id AND source.department_id=target.department_id
  WHERE target.department_id=$1 AND target.id=$2 AND target.cancelled_at IS NULL AND source.cancelled_at IS NULL`;
function visibilityData(row: VisibilityRow) {
  return { sourceId: row.sourceId, items: row.sourcePlan.flatMap(({ agendaItemId, title, startTime }) => agendaItemId
    ? [{ id: agendaItemId, title, startTime, hidden: row.hiddenIds.includes(agendaItemId) }] : []) };
}
const uuid = { type: "string", format: "uuid" } as const;
const optionalId = { anyOf: [uuid, { type: "null" }] } as const;
const schema = { params: { type: "object", required: ["id"], properties: { id: uuid } },
  body: { type: "object", additionalProperties: false, required: ["sourceId", "expectedSourceId"],
    properties: { sourceId: optionalId, expectedSourceId: optionalId } } } as const;

function canShare(event?: AgendaEvent) {
  return event && !event.source_system && !event.cancelled_at && !event.recurrence_id;
}

export function registerSharedEventAgenda(app: FastifyInstance, {
  pool, available, resolveScope, validateMutation, lockDepartmentForWrite,
}: Dependencies) {
  app.get<{ Params: Params }>(visibilityPath, { schema: { params: schema.params } }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (!pool || !available()) return reply.code(503).send({ error: "Shared agendas are unavailable." });
    const departmentId = await resolveScope(request, reply);
    if (!departmentId) return reply;
    const { rows: [row] } = await pool.query<VisibilityRow>(visibilityQuery, [departmentId, request.params.id]);
    if (!row) return reply.code(404).send({ error: "This event has no linked agenda." });
    return visibilityData(row);
  });

  app.put<{ Params: VisibilityParams; Body: VisibilityBody }>(visibilityPath + "/:itemId", { schema: {
    params: { type: "object", required: ["id", "itemId"], properties: { id: uuid, itemId: uuid } },
    body: { type: "object", additionalProperties: false, required: ["expectedSourceId", "hidden"],
      properties: { expectedSourceId: uuid, hidden: { type: "boolean" } } },
  } }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (!pool || !available()) return reply.code(503).send({ error: "Shared agendas are unavailable." });
    const departmentId = await resolveScope(request, reply);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const { id, itemId } = request.params;
    const { expectedSourceId, hidden } = request.body;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      await client.query("SELECT id FROM service_events WHERE department_id=$1 AND id=$2 FOR UPDATE", [departmentId, expectedSourceId]);
      const { rows: [row] } = await client.query<VisibilityRow>(visibilityQuery + " AND source.id=$3 FOR UPDATE OF target",
        [departmentId, id, expectedSourceId]);
      if (!row || !row.sourcePlan.some((item) => item.agendaItemId === itemId)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The shared agenda changed. Reload the event and try again." });
      }
      const ids = new Set(row.hiddenIds);
      if (hidden) ids.add(itemId);
      else ids.delete(itemId);
      const hiddenIds = [...ids];
      const { rows: [updated] } = await client.query<{ timePlan: ServicePlanItem[] }>(`UPDATE service_events target SET shared_agenda_hidden_item_ids=$4::uuid[],
        time_plan=shared_event_agenda_plan(source.time_plan,
          (extract(epoch FROM (target.start_time - source.start_time))/60)::integer, $4::uuid[])
        FROM service_events source WHERE target.department_id=$1 AND target.id=$2 AND source.department_id=$1 AND source.id=$3
        RETURNING target.time_plan AS "timePlan"`,
      [departmentId, id, expectedSourceId, hiddenIds]);
      await client.query("COMMIT");
      return { ...visibilityData({ ...row, hiddenIds }), timePlan: updated.timePlan };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "40P01") return reply.code(409).send({ error: "The agendas changed concurrently. Try again." });
      throw error;
    } finally {
      client.release();
    }
  });

  app.put<{ Params: Params; Body: Body }>(path, { schema }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (!pool || !available()) return reply.code(503).send({ error: "Shared agendas are unavailable." });
    const departmentId = await resolveScope(request, reply);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const { sourceId, expectedSourceId } = request.body;
    const targetId = request.params.id;
    if (sourceId === targetId) return reply.code(400).send({ error: "Choose a different event as the agenda source." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const readEvent = async (id: string) => (await client.query<AgendaEvent>(
        "SELECT source_system,cancelled_at,recurrence_id,event_date::text,is_all_day,shared_agenda_source_id," +
        "jsonb_array_length(time_plan) AS items FROM service_events WHERE department_id=$1 AND id=$2 FOR UPDATE",
        [departmentId, id],
      )).rows[0];
      // Take the source lock before the target, matching propagation order.
      const source = sourceId ? await readEvent(sourceId) : undefined;
      if (sourceId && (!source || !canShare(source) || source.shared_agenda_source_id || !source.items || source.items > 100)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The agenda source is unavailable for linking." });
      }
      const target = await readEvent(targetId);
      if (!target) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Event not found." });
      }
      if (!canShare(target) || expectedSourceId !== target.shared_agenda_source_id
        || (source && (source.event_date !== target.event_date || source.is_all_day !== target.is_all_day))) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Choose active events of the same schedule type and date, then try again." });
      }
      if (sourceId) {
        const { rows: [limits] } = await client.query<{ targetIsSource: boolean; linkedCount: number }>(
          `SELECT EXISTS(SELECT 1 FROM service_events WHERE department_id=$1 AND shared_agenda_source_id=$2) AS "targetIsSource",
            (SELECT count(*)::integer FROM service_events WHERE department_id=$1 AND shared_agenda_source_id=$3) AS "linkedCount"`,
          [departmentId, targetId, sourceId],
        );
        if (limits.targetIsSource || (limits.linkedCount >= 30 && sourceId !== target.shared_agenda_source_id)) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "This link would join two shared agendas or exceed the 30 linked-event limit." });
        }
        await client.query("UPDATE service_events SET time_plan=identify_shared_agenda_items(time_plan) WHERE department_id=$1 AND id=$2",
          [departmentId, sourceId]);
        await client.query(`UPDATE service_events target SET shared_agenda_source_id=source.id,
          time_plan=shared_event_agenda_plan(source.time_plan, (extract(epoch FROM (target.start_time - source.start_time))/60)::integer,
            CASE WHEN target.shared_agenda_source_id=source.id THEN target.shared_agenda_hidden_item_ids ELSE '{}' END)
          FROM service_events source WHERE target.id=$2 AND target.department_id=$1 AND source.id=$3 AND source.department_id=$1`,
        [departmentId, targetId, sourceId]);
      } else {
        await client.query("UPDATE service_events SET shared_agenda_source_id=NULL WHERE department_id=$1 AND id=$2",
          [departmentId, targetId]);
      }
      await client.query("COMMIT");
      return { sharedAgendaSourceId: sourceId };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "40P01") return reply.code(409).send({ error: "The agendas changed concurrently. Try again." });
      throw error;
    } finally {
      client.release();
    }
  });
}
