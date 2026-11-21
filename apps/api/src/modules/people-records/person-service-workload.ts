import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

type WorkloadScope = (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>;
const pageSize = 50;

export function registerPersonServiceWorkload(app: FastifyInstance, context: ModuleServerContext, resolvePrivatePeopleLocation: WorkloadScope) {
  app.get<{ Params: { contactId: string }; Querystring: { month?: string; offset?: number } }>("/api/people-records/:contactId/service-workload", {
    schema: {
      params: { type: "object", required: ["contactId"], additionalProperties: false, properties: { contactId: { type: "string", format: "uuid" } } },
      querystring: { type: "object", additionalProperties: false, properties: {
        month: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" },
        offset: { type: "integer", minimum: 0, maximum: 1000000 },
      } },
    },
  }, async (request, reply) => {
    const departmentId = await resolvePrivatePeopleLocation(request, reply);
    if (!departmentId) return reply;
    if (request.activeDepartmentRole !== "site_admin" && !(request.activeDepartmentPermissions ?? []).includes("events_manage")) {
      return reply.code(403).send({ error: "Event management access is required to view a person's service assignments." });
    }
    const { month, offset = 0 } = request.query;
    const { rows: [workload] } = await context.pool!.query(
      `WITH scope AS (
         SELECT person.id,date_trunc('month',now() AT TIME ZONE COALESCE((SELECT name FROM pg_timezone_names WHERE name=location.time_zone),'UTC'))::date AS current_month
           FROM contacts person JOIN departments location ON location.id=person.department_id
          WHERE person.department_id=$1 AND person.id=$2
       ), months AS (
         SELECT (scope.current_month + relative.index*interval '1 month')::date AS start_date
           FROM scope CROSS JOIN generate_series(-2,1) relative(index)
       ), selected_month AS (
         SELECT COALESCE((SELECT start_date FROM months WHERE to_char(start_date,'YYYY-MM')=$3),current_month) AS start_date
           FROM scope
       ), assigned AS MATERIALIZED (
         SELECT event.id AS "eventId",event.title,event.event_date::text AS "eventDate",
                (position.ordinality-1)::int AS "positionIndex",position.value->>'name' AS role,
                NULLIF(btrim(position.value->>'category'),'') AS category,
                CASE response.status WHEN 'accepted' THEN 'confirmed' WHEN 'declined' THEN 'declined' ELSE 'requested' END AS status,
                date_trunc('month',event.event_date)::date AS month
           FROM scope JOIN service_events event ON event.department_id=$1 AND event.cancelled_at IS NULL
            AND event.event_date>=scope.current_month-interval '2 months' AND event.event_date<scope.current_month+interval '2 months'
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(event.positions)='array' THEN event.positions ELSE '[]'::jsonb END
           ) WITH ORDINALITY position(value,ordinality)
           LEFT JOIN event_position_responses response ON response.event_id=event.id AND response.contact_id=scope.id
            AND response.position_index=position.ordinality-1
          WHERE lower(position.value->>'contactId')=scope.id::text
       ), monthly AS (
         SELECT months.start_date,count(assigned."eventId") FILTER(WHERE assigned.status='confirmed')::int AS confirmed,
                count(assigned."eventId") FILTER(WHERE assigned.status='requested')::int AS requested,
                count(assigned."eventId") FILTER(WHERE assigned.status='declined')::int AS declined
           FROM months LEFT JOIN assigned ON assigned.month=months.start_date GROUP BY months.start_date
       ), page AS (
         SELECT "eventId",title,"eventDate","positionIndex",role,category,status
           FROM assigned WHERE month=(SELECT start_date FROM selected_month)
          ORDER BY "eventDate","eventId","positionIndex" LIMIT $4 OFFSET $5
       )
       SELECT to_char(selected_month.start_date,'YYYY-MM') AS "selectedMonth",
              (SELECT jsonb_agg(jsonb_build_object('month',to_char(start_date,'YYYY-MM'),'confirmed',confirmed,'requested',requested,'declined',declined)
                       ORDER BY start_date) FROM monthly) AS months,
              (SELECT COUNT(*)::int FROM assigned WHERE month=selected_month.start_date) AS total,
              COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY "eventDate","eventId","positionIndex") FROM page),'[]'::jsonb) AS assignments
         FROM selected_month`, [departmentId, request.params.contactId, month ?? null, pageSize, offset],
    );
    if (!workload) return reply.code(404).send({ error: "Person not found in this location." });
    return reply.header("Cache-Control", "private, no-store").send({ ...workload, offset, pageSize });
  });
}
