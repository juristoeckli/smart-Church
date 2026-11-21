import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ModuleServerContext } from "../module-sdk.js";

const uuid = { type: "string", format: "uuid" };
const date = { type: "string", format: "date" };
type AbsenceReason = "holiday" | "illness" | "family" | "work" | "other";

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const { pool, isDatabaseReady, resolveDepartmentId, validateMutation, realtime } = context;
  const isManager = (request: FastifyRequest) => request.activeDepartmentRole === "site_admin"
    || (request.activeDepartmentPermissions ?? []).includes("events_manage")
    || (request.activeDepartmentModulePermissions?.["event-absences"] ?? []).includes("manage");

  async function site(request: FastifyRequest, reply: FastifyReply) {
    if (!pool || !isDatabaseReady()) { reply.code(503).send({ error: "Volunteer absences are unavailable while the database is offline." }); return null; }
    const departmentId = await resolveDepartmentId(request, reply);
    if (!departmentId) return null;
    // Any authenticated member who can resolve this location may manage only
    // their own absence record; manager-only views enforce their own grant.
    return departmentId;
  }

  async function linkedContact(request: FastifyRequest, departmentId: string) {
    const result = await pool!.query<{ contact_id: string }>(
      `SELECT membership.contact_id FROM department_memberships membership
        JOIN contacts person ON person.id=membership.contact_id AND person.department_id=membership.department_id
       WHERE membership.user_id=$1 AND membership.department_id=$2 AND membership.contact_id IS NOT NULL LIMIT 1`,
      [request.authenticatedUser!.id, departmentId],
    );
    return result.rows[0]?.contact_id ?? null;
  }

  async function audit(departmentId: string, absenceId: string, request: FastifyRequest, action: "created" | "cancelled", details: Record<string, unknown> = {}) {
    await pool!.query("INSERT INTO event_person_absence_audit(id,department_id,absence_id,actor_user_id,action,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
      [randomUUID(), departmentId, absenceId, request.authenticatedUser!.id, action, JSON.stringify(details)]);
  }

  app.get("/api/modules/event-absences/bootstrap", async (request, reply) => {
    const departmentId = await site(request, reply);
    if (!departmentId) return reply;
    const contactId = await linkedContact(request, departmentId);
    if (!contactId && !isManager(request)) return reply.code(409).send({ error: "Link your user account to a People record before recording availability." });
    if (!contactId) return { absences: [], canManage: true };
    const absences = await pool!.query(
      `SELECT id,starts_on::text AS "startsOn",ends_on::text AS "endsOn",reason,private_note AS "privateNote",status,created_at AS "createdAt",cancelled_at AS "cancelledAt"
         FROM event_person_absences WHERE department_id=$1 AND contact_id=$2 ORDER BY starts_on DESC,id DESC LIMIT 300`,
      [departmentId, contactId],
    );
    return { absences: absences.rows, canManage: isManager(request) };
  });

  app.post<{ Body: { startsOn: string; endsOn: string; reason: AbsenceReason; privateNote?: string } }>("/api/modules/event-absences/absences", {
    schema: { body: { type: "object", additionalProperties: false, required: ["startsOn", "endsOn", "reason"], properties: { startsOn: date, endsOn: date, reason: { type: "string", enum: ["holiday", "illness", "family", "work", "other"] }, privateNote: { type: "string", maxLength: 1000 } } } },
  }, async (request, reply) => {
    const departmentId = await site(request, reply);
    if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    if (!isIsoDate(request.body.startsOn) || !isIsoDate(request.body.endsOn) || request.body.endsOn < request.body.startsOn) return reply.code(400).send({ error: "Choose a valid absence date range." });
    const contactId = await linkedContact(request, departmentId);
    if (!contactId) return reply.code(409).send({ error: "Link your user account to a People record before recording availability." });
    const client = await pool!.connect();
    const id = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`absence:${departmentId}:${contactId}`]);
      const overlap = await client.query("SELECT 1 FROM event_person_absences WHERE department_id=$1 AND contact_id=$2 AND status='active' AND starts_on<=$4::date AND ends_on>=$3::date LIMIT 1", [departmentId, contactId, request.body.startsOn, request.body.endsOn]);
      if (overlap.rowCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "This date range overlaps an active absence. Edit the existing range or cancel it first." }); }
      await client.query("INSERT INTO event_person_absences(id,department_id,contact_id,starts_on,ends_on,reason,private_note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, departmentId, contactId, request.body.startsOn, request.body.endsOn, request.body.reason, (request.body.privateNote ?? "").trim(), request.authenticatedUser!.id]);
      await client.query("INSERT INTO event_person_absence_audit(id,department_id,absence_id,actor_user_id,action,details) VALUES($1,$2,$3,$4,'created',$5::jsonb)",
        [randomUUID(), departmentId, id, request.authenticatedUser!.id, JSON.stringify({ startsOn: request.body.startsOn, endsOn: request.body.endsOn, reason: request.body.reason })]);
      await client.query("COMMIT");
      realtime.publish("module:event-absences:changed", departmentId, { action: "absence-created", absenceId: id });
      return reply.code(201).send({ id });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.post<{ Params: { id: string } }>("/api/modules/event-absences/absences/:id/cancel", {
    schema: { params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } } },
  }, async (request, reply) => {
    const departmentId = await site(request, reply);
    if (!departmentId) return reply;
    if (!validateMutation(request, reply)) return reply;
    const contactId = isManager(request) ? null : await linkedContact(request, departmentId);
    if (!isManager(request) && !contactId) return reply.code(409).send({ error: "Link your user account to a People record before managing availability." });
    const result = await pool!.query(
      `UPDATE event_person_absences SET status='cancelled',cancelled_by=$4,cancelled_at=now()
        WHERE id=$1 AND department_id=$2 AND status='active' AND ($3 OR contact_id=$5) RETURNING id,contact_id`,
      [request.params.id, departmentId, isManager(request), request.authenticatedUser!.id, contactId],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Active absence not found." });
    await audit(departmentId, request.params.id, request, "cancelled", { contactId: result.rows[0].contact_id });
    realtime.publish("module:event-absences:changed", departmentId, { action: "absence-cancelled", absenceId: request.params.id });
    return { cancelled: true };
  });

  app.get<{ Querystring: { from?: string; to?: string } }>("/api/modules/event-absences/role-conflicts", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["from", "to"], properties: { from: date, to: date } } },
  }, async (request, reply) => {
    const departmentId = await site(request, reply);
    if (!departmentId) return reply;
    if (!isManager(request)) return reply.code(403).send({ error: "Event manager access is required to view team absence conflicts." });
    if (!isIsoDate(request.query.from!) || !isIsoDate(request.query.to!) || request.query.to! < request.query.from!) return reply.code(400).send({ error: "Choose a valid date range." });
    const result = await pool!.query(
      `SELECT event.id AS "eventId",event.event_date::text AS "eventDate",event.title AS "eventTitle",
              role_item.value->>'name' AS role,person.id AS "contactId",concat_ws(' ',person.first_name,person.last_name) AS "personName",
              COALESCE(response.status,'pending') AS "responseStatus",absence.id AS "absenceId",absence.starts_on::text AS "absenceStartsOn",
              absence.ends_on::text AS "absenceEndsOn",absence.reason
         FROM service_events event
         CROSS JOIN LATERAL jsonb_array_elements(event.positions) WITH ORDINALITY AS role_item(value,position_number)
         JOIN contacts person ON person.department_id=event.department_id
          AND person.id=CASE WHEN role_item.value->>'contactId' ~* '^[0-9a-f-]{36}$' THEN (role_item.value->>'contactId')::uuid ELSE NULL END
         LEFT JOIN event_position_responses response ON response.event_id=event.id AND response.position_index=(role_item.position_number-1)::int AND response.contact_id=person.id
         JOIN event_person_absences absence ON absence.department_id=event.department_id AND absence.contact_id=person.id AND absence.status='active'
          AND event.event_date BETWEEN absence.starts_on AND absence.ends_on
        WHERE event.department_id=$1 AND event.event_date BETWEEN $2::date AND $3::date
        ORDER BY event.event_date,event.start_time,lower(role_item.value->>'name'),person.last_name,person.first_name LIMIT 5000`,
      [departmentId, request.query.from, request.query.to],
    );
    return result.rows;
  });
}
