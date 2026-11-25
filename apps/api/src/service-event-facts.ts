import { randomUUID } from "node:crypto";
import { csvDocument } from "./csv-export.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { ServiceEventFactDefinition, ServiceEventFacts, ServiceEventFactsPeriod } from "@smart-church/contracts";

type Dependencies = {
  pool: Pool | null;
  available: () => boolean;
  resolveScope: (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
  validateMutation: (request: FastifyRequest, reply: FastifyReply) => boolean;
  lockDepartmentForWrite: (client: PoolClient, departmentId: string) => Promise<boolean>;
};
const path = "/api/events/:id/recorded-facts";
const definitionsPath = "/api/events/recorded-fact-definitions";
const numericValue = /^-?(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,3})?$/;
const definitionFields = 'id,label,kind,unit,options,archived_at AS "archivedAt"';
type DefinitionInput = Pick<ServiceEventFactDefinition, "label" | "kind"> & { unit?: string; options?: string[] };
type FactsInput = Omit<ServiceEventFacts, "custom"> & { custom?: Record<string, string | null> };
const definitionBody = { type: "object", additionalProperties: false, required: ["label", "kind"], properties: {
  label: { type: "string", minLength: 1, maxLength: 80 },
  kind: { type: "string", enum: ["number", "select"] },
  unit: { type: "string", maxLength: 24 },
  options: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 80 } },
} } as const;
const params = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const count = { type: "integer", minimum: 0, maximum: 1_000_000 } as const;
const body = { type: "object", additionalProperties: false, properties: {
  visitors: count, firstTimeVisitors: count,
  custom: { type: "object", maxProperties: 100, propertyNames: {
    pattern: "^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$",
  }, additionalProperties: { anyOf: [{ type: "null" }, { type: "string", minLength: 1, maxLength: 80 }] } },
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

  app.get(definitionsPath, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId) return reply;
    const { rows } = await pool!.query<ServiceEventFactDefinition>(
      "SELECT " + definitionFields + " FROM service_event_fact_definitions WHERE department_id=$1 ORDER BY archived_at NULLS FIRST,lower(label),id",
      [departmentId]);
    return { definitions: rows };
  });

  app.post<{ Body: DefinitionInput }>(definitionsPath, { schema: { body: definitionBody } }, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const label = request.body.label.trim();
    const unit = request.body.unit?.trim() || null;
    const options = (request.body.options ?? []).map((option) => option.trim());
    const kind = request.body.kind;
    if (!label || (kind === "number" && options.length) || (kind === "select" && (unit || options.length < 2
      || options.some((option) => !option) || new Set(options.map((option) => option.toLowerCase())).size !== options.length))) {
      return reply.code(400).send({ error: "Enter a label and valid, distinct options for select facts, or a unit for a numeric fact." });
    }
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const { rows: [created] } = await client.query<ServiceEventFactDefinition>(
        "INSERT INTO service_event_fact_definitions(id,department_id,label,kind,unit,options) VALUES($1,$2,$3,$4,$5,$6) RETURNING " + definitionFields,
        [randomUUID(), departmentId, label, kind, unit, options]);
      await client.query("COMMIT");
      return reply.code(201).send(created);
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "An active fact already uses that label." });
      throw error;
    } finally { client.release(); }
  });

  app.post<{ Params: { id: string } }>(definitionsPath + "/:id/archive", { schema: { params } }, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const { rows: [definition] } = await client.query<ServiceEventFactDefinition>(
        "UPDATE service_event_fact_definitions SET archived_at=COALESCE(archived_at,now()) WHERE department_id=$1 AND id=$2 RETURNING " + definitionFields,
        [departmentId, request.params.id]);
      await client.query("COMMIT");
      return definition ?? reply.code(404).send({ error: "Event fact definition could not be found." });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  app.get<{ Params: { id: string } }>(path, { schema: { params } }, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId) return reply;
    const { rows: [event] } = await pool!.query<EventRow>(eventFacts, [departmentId, request.params.id]);
    if (!event) return reply.code(404).send({ error: "Event could not be found." });
    return { facts: event.facts ?? {}, editable: !event.source_system && !event.cancelled_at };
  });

  app.put<{ Params: { id: string }; Body: FactsInput }>(path, { schema: { params, body } }, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId || !validateMutation(request, reply)) return reply;
    const { custom: changes = {}, ...fixed } = request.body;
    if (fixed.visitors !== undefined && fixed.firstTimeVisitors !== undefined && fixed.firstTimeVisitors > fixed.visitors) {
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
      const custom = { ...event.facts?.custom };
      if (Object.keys(changes).length) {
        const { rows } = await client.query<ServiceEventFactDefinition>(
          "SELECT " + definitionFields + " FROM service_event_fact_definitions WHERE department_id=$1 AND archived_at IS NULL AND id=ANY($2::uuid[]) FOR SHARE",
          [departmentId, Object.keys(changes)]);
        const activeDefinitions = new Map(rows.map((definition) => [definition.id, definition]));
        for (const [id, value] of Object.entries(changes)) {
          const definition = activeDefinitions.get(id);
          if (!definition || (value !== null && !(definition.kind === "number" ? numericValue.test(value) : definition.options.includes(value)))) {
            await client.query("ROLLBACK");
            return reply.code(400).send({ error: "A custom fact or its value is no longer valid for this location." });
          }
          if (value === null) delete custom[id];
          else custom[id] = value;
        }
      }
      const facts: ServiceEventFacts = Object.keys(custom).length ? { ...fixed, custom } : fixed;
      await client.query("UPDATE service_events SET recorded_facts=$3::jsonb WHERE department_id=$1 AND id=$2",
        [departmentId, request.params.id, Object.keys(facts).length ? JSON.stringify(facts) : null]);
      await client.query("COMMIT");
      return { facts, editable: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  app.get<{ Querystring: { from: string; to: string; calendarId?: string } }>("/api/events/recorded-facts-export", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["from", "to"], properties: {
      from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, calendarId: { type: "string", format: "uuid" },
    } } },
  }, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId) return reply;
    const { from, to, calendarId } = request.query;
    if (from > to) return reply.code(400).send({ error: "The end date must be on or after the start date." });
    let calendarFilter = "";
    const values: (string | null)[] = [departmentId, from, to];
    if (calendarId) {
      const { rows: [schema] } = await pool!.query<{ ready: boolean }>(
        "SELECT to_regclass('church_calendar_event_generations') IS NOT NULL AND to_regclass('church_calendar_appointments') IS NOT NULL AND to_regclass('church_calendar_calendars') IS NOT NULL AS ready",
      );
      if (!schema.ready) return reply.code(404).send({ error: "Calendar filtering is unavailable." });
      values.push(calendarId, request.authenticatedUser?.id ?? null);
      calendarFilter = `AND EXISTS (
        SELECT 1 FROM church_calendar_event_generations generation
        JOIN church_calendar_appointments appointment ON appointment.id=generation.appointment_id AND appointment.department_id=generation.department_id
        JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
        WHERE generation.department_id=event.department_id AND generation.service_event_id=event.id AND calendar.id=$4
          AND calendar.archived_at IS NULL AND (calendar.scope<>'personal' OR calendar.owner_user_id=$5)
      )`;
    }
    const [events, definitions] = await Promise.all([
      pool!.query<{ id: string; date: string; title: string; facts: ServiceEventFacts }>(
        `SELECT id,event_date::text AS date,title,recorded_facts AS facts FROM service_events event
          WHERE department_id=$1 AND cancelled_at IS NULL AND event_date BETWEEN $2::date AND $3::date
            AND recorded_facts IS NOT NULL AND recorded_facts<>'{}'::jsonb ${calendarFilter}
          ORDER BY event_date,id LIMIT 10001`, values),
      pool!.query<ServiceEventFactDefinition>(
        "SELECT " + definitionFields + " FROM service_event_fact_definitions WHERE department_id=$1 ORDER BY lower(label),id", [departmentId]),
    ]);
    if (events.rows.length > 10000) return reply.code(422).send({ error: "Choose a shorter date range to export up to 10,000 events." });
    return reply.type("text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="event-facts-${from}-to-${to}.csv"`)
      .send(csvDocument(
        ["Event ID", "Date", "Event", "Visitors", "First-time visitors", "Collection", "Currency",
          ...definitions.rows.map(field => field.unit ? field.label + " (" + field.unit + ")" : field.label)],
        events.rows.map(({ id, date, title, facts }) => [id, date, title, facts.visitors, facts.firstTimeVisitors,
          facts.collection?.amount, facts.collection?.currency, ...definitions.rows.map(field => {
            const value = facts.custom?.[field.id];
            return field.kind === "number" && value && numericValue.test(value) ? Number(value) : value;
          })]),
      ));
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
    ), custom_values AS (
      SELECT f.start_date,d.id,d.kind,value
      FROM facts f CROSS JOIN LATERAL jsonb_each_text(f.f->'custom') AS entry(key,value)
      JOIN service_event_fact_definitions d ON d.department_id=$1 AND d.id::text=entry.key
    ), custom_select_counts AS (
      SELECT start_date,id,value,count(*)::text amount FROM custom_values WHERE kind='select'
      GROUP BY start_date,id,value
    ), custom_summaries AS (
      SELECT start_date,id,json_build_object('id',id,'total',SUM(value::numeric)::text) result
      FROM custom_values WHERE kind='number' GROUP BY start_date,id
      UNION ALL
      SELECT start_date,id,json_build_object('id',id,'counts',json_agg(json_build_object('value',value,'count',amount) ORDER BY value))
      FROM custom_select_counts GROUP BY start_date,id
    )
    SELECT to_char(start_date,'YYYY-MM') period, SUM((f->>'visitors')::bigint)::text visitors,
      SUM((f->>'firstTimeVisitors')::bigint)::text AS "firstTimeVisitors",
      COALESCE((SELECT json_agg(json_build_object('amount',amount,'currency',currency) ORDER BY currency)
        FROM collections c WHERE c.start_date=facts.start_date), '[]'::json) collections,
      COALESCE((SELECT json_agg(result ORDER BY id) FROM custom_summaries c WHERE c.start_date=facts.start_date), '[]'::json) custom
    FROM facts GROUP BY start_date ORDER BY start_date DESC`, [departmentId, request.query.period + "-01"]);
    return { periods: rows };
  });
}
