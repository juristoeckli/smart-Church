import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { ServiceEventFacts, ServiceEventFactsPeriod } from "@smart-church/contracts";

type Dependencies = {
  pool: Pool | null;
  available: () => boolean;
  resolveScope: (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
  validateMutation: (request: FastifyRequest, reply: FastifyReply) => boolean;
  lockDepartmentForWrite: (client: PoolClient, departmentId: string) => Promise<boolean>;
};
const path = "/api/events/:id/recorded-facts";
const params = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const count = { type: "integer", minimum: 0, maximum: 1_000_000 } as const;
const body = { type: "object", additionalProperties: false, properties: {
  visitors: count, firstTimeVisitors: count,
  collection: { type: "object", additionalProperties: false, required: ["amount", "currency"], properties: {
    amount: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,3})?$" },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
  } },
} } as const;
const eventFacts = `SELECT recorded_facts AS facts, source_system, cancelled_at
  FROM service_events WHERE department_id=$1 AND id=$2`;
type EventRow = { facts: ServiceEventFacts | null; source_system: string | null; cancelled_at: Date | null };

export function registerServiceEventFactsRoutes(app: FastifyInstance, { pool, available, resolveScope, validateMutation, lockDepartmentForWrite }: Dependencies) {
  async function scope(request: FastifyRequest, reply: FastifyReply) {
    if (!pool || !available()) {
      reply.code(503).send({ error: "Event facts are unavailable." });
      return null;
    }
    reply.header("Cache-Control", "private, no-store");
    return resolveScope(request, reply);
  }

  app.get<{ Params: { id: string } }>(path, { schema: { params } }, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId) return reply;
    const { rows: [event] } = await pool!.query<EventRow>(eventFacts, [departmentId, request.params.id]);
    if (!event) return reply.code(404).send({ error: "Event could not be found." });
    return { facts: event.facts ?? {}, editable: !event.source_system && !event.cancelled_at };
  });

  app.put<{ Params: { id: string }; Body: ServiceEventFacts }>(path, { schema: { params, body } }, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const facts = request.body;
    if (facts.visitors !== undefined && facts.firstTimeVisitors !== undefined && facts.firstTimeVisitors > facts.visitors) {
      return reply.code(400).send({ error: "First-time visitors cannot exceed total visitors." });
    }

    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const { rows: [event] } = await client.query<EventRow>(eventFacts + " FOR UPDATE", [departmentId, request.params.id]);
      if (!event || event.source_system || event.cancelled_at) {
        await client.query("ROLLBACK");
        return !event ? reply.code(404).send({ error: "Event could not be found." })
          : reply.code(409).send({ error: "Facts cannot be changed on imported or cancelled events." });
      }
      await client.query("UPDATE service_events SET recorded_facts=$3::jsonb WHERE department_id=$1 AND id=$2",
        [departmentId, request.params.id, Object.keys(facts).length ? JSON.stringify(facts) : null]);
      await client.query("COMMIT");
      return { facts, editable: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  app.get<{ Querystring: { period: string } }>("/api/events/recorded-facts-summary", { schema: {
    querystring: { type: "object", required: ["period"], properties: {
      period: { type: "string", pattern: "^(?:19[1-9][0-9]|2[0-9]{3})-(?:0[1-9]|1[0-2])$" },
    } },
  } }, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId) return reply;
    const { rows } = await pool!.query<ServiceEventFactsPeriod>(`WITH periods AS (
      SELECT $2::date start_date UNION ALL SELECT ($2::date - interval '1 year')::date
    ), facts AS (
      SELECT p.start_date, e.recorded_facts f FROM periods p LEFT JOIN service_events e
        ON e.department_id=$1 AND e.cancelled_at IS NULL AND e.recorded_facts IS NOT NULL
        AND e.event_date>=p.start_date AND e.event_date<p.start_date + interval '1 month'
    ), collections AS (
      SELECT start_date, f->'collection'->>'currency' currency,
        SUM((f->'collection'->>'amount')::numeric)::text amount
      FROM facts WHERE f ? 'collection' GROUP BY start_date, currency
    )
    SELECT to_char(start_date,'YYYY-MM') period, SUM((f->>'visitors')::bigint)::text visitors,
      SUM((f->>'firstTimeVisitors')::bigint)::text AS "firstTimeVisitors",
      COALESCE((SELECT json_agg(json_build_object('amount',amount,'currency',currency) ORDER BY currency)
        FROM collections c WHERE c.start_date=facts.start_date), '[]'::json) collections
    FROM facts GROUP BY start_date ORDER BY start_date DESC`, [departmentId, request.query.period + "-01"]);
    return { periods: rows };
  });
}
