import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";

type Scope = (request: FastifyRequest, reply: FastifyReply, manage: boolean) => Promise<string | null>;
type Dependencies = { pool: Pool | null; available: () => boolean; resolveScope: Scope;
  validateMutation: (request: FastifyRequest, reply: FastifyReply) => boolean;
  lockDepartmentForWrite: (db: PoolClient, departmentId: string) => Promise<boolean> };
type Range = { startsOn: string; endsOn: string };
type Row = Range & { id: string };
const path = "/api/events/volunteer-absences";
const localPerson = `SELECT c.id FROM department_memberships m JOIN contacts c
  ON c.id=m.contact_id AND c.department_id=m.department_id AND c.archived_at IS NULL
  WHERE m.department_id=$1 AND m.user_id=$2`;
const dates = 'starts_on::text AS "startsOn",ends_on::text AS "endsOn"';
const params = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const body = { type: "object", additionalProperties: false, required: ["startsOn", "endsOn"],
  properties: { startsOn: { type: "string", format: "date" }, endsOn: { type: "string", format: "date" } } } as const;

export function volunteerAbsenceDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
export function validVolunteerAbsenceRange({ startsOn, endsOn }: Range) {
  return volunteerAbsenceDay(startsOn) && volunteerAbsenceDay(endsOn) && startsOn <= endsOn
    && Date.parse(endsOn) - Date.parse(startsOn) <= 365 * 86_400_000;
}

export function registerEventVolunteerAbsenceRoutes(app: FastifyInstance, deps: Dependencies) {
  const { pool, resolveScope } = deps;
  async function scope(request: FastifyRequest, reply: FastifyReply, manage = false) {
    if (!pool || !deps.available()) { reply.code(503).send({ error: "Volunteer availability is unavailable." }); return null; }
    if (!request.authenticatedUser?.id) { reply.code(403).send({ error: "Sign in to use volunteer availability." }); return null; }
    return resolveScope(request, reply, manage);
  }
  app.get(path, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId) return reply;
    const actor = request.authenticatedUser!.id;
    const { rows: [person] } = await pool!.query<{ id: string }>(localPerson, [departmentId, actor]);
    const result = person ? await pool!.query<Row>(`SELECT id,${dates} FROM event_volunteer_absences
      WHERE department_id=$1 AND contact_id=($3::uuid) AND contact_id=(${localPerson}) ORDER BY starts_on,ends_on,id`, [departmentId, actor, person.id]) : { rows: [] };
    return reply.header("Cache-Control", "private, no-store").send({ linked: !!person, rows: result.rows });
  });
  async function mutate(request: FastifyRequest, reply: FastifyReply, id: string | undefined, range: Range | undefined) {
    const departmentId = await scope(request, reply);
    if (!departmentId || !deps.validateMutation(request, reply)) return reply;
    if (range && !validVolunteerAbsenceRange(range)) return reply.code(400).send({ error: "Choose a date range of up to 366 calendar days." });
    const db = await pool!.connect();
    try {
      await db.query("BEGIN");
      if (!await deps.lockDepartmentForWrite(db, departmentId)) {
        await db.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const { rows: [person] } = await db.query<{ id: string }>(localPerson + " FOR SHARE OF m,c", [departmentId, request.authenticatedUser!.id]);
      if (!person) {
        await db.query("ROLLBACK");
        return reply.code(403).send({ error: "Link your account to a People record at this location first." });
      }
      const key = [departmentId, person.id, id ?? randomUUID()];
      const result = range
        ? id
          ? await db.query<Row>(`UPDATE event_volunteer_absences SET starts_on=$4,ends_on=$5,updated_at=now()
              WHERE department_id=$1 AND contact_id=$2 AND id=$3 RETURNING id,${dates}`, [...key, range.startsOn, range.endsOn])
          : await db.query<Row>(`INSERT INTO event_volunteer_absences(department_id,contact_id,id,starts_on,ends_on)
              VALUES($1,$2,$3,$4,$5) RETURNING id,${dates}`, [...key, range.startsOn, range.endsOn])
        : await db.query("DELETE FROM event_volunteer_absences WHERE department_id=$1 AND contact_id=$2 AND id=$3 RETURNING id", key);
      if (!result.rowCount) {
        await db.query("ROLLBACK");
        return reply.code(404).send({ error: "This absence could not be found." });
      }
      await db.query("COMMIT");
      return reply.code(range && !id ? 201 : 200).header("Cache-Control", "private, no-store").send(range ? result.rows[0] : { deleted: true });
    } catch (error) {
      await db.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        return reply.code(409).send({ error: "This exact date range is already recorded." });
      }
      throw error;
    } finally { db.release(); }
  }
  app.post<{ Body: Range }>(path, { schema: { body } }, (request, reply) => mutate(request, reply, undefined, request.body));
  app.put<{ Params: { id: string }; Body: Range }>(`${path}/:id`, { schema: { params, body } }, (request, reply) => mutate(request, reply, request.params.id, request.body));
  app.delete<{ Params: { id: string } }>(`${path}/:id`, { schema: { params } }, (request, reply) => mutate(request, reply, request.params.id, undefined));

  app.get<{ Params: { id: string } }>("/api/events/:id/volunteer-conflicts", { schema: { params } }, async (request, reply) => {
    const departmentId = await scope(request, reply, true);
    if (!departmentId) return reply;
    const result = await pool!.query<{ positionIndex: number; name: string }>(`SELECT (position.ordinality - 1)::int AS "positionIndex",position.data->>'name' AS name
      FROM service_events event CROSS JOIN LATERAL jsonb_array_elements(event.positions) WITH ORDINALITY position(data,ordinality)
      WHERE event.department_id=$1 AND event.id=$2 AND event.cancelled_at IS NULL AND EXISTS (
        SELECT 1 FROM event_volunteer_absences absence JOIN contacts c
          ON c.id=absence.contact_id AND c.department_id=absence.department_id AND c.archived_at IS NULL
        WHERE absence.department_id=event.department_id AND absence.contact_id::text=position.data->>'contactId'
          AND event.event_date BETWEEN absence.starts_on AND absence.ends_on)
      ORDER BY position.ordinality`, [departmentId, request.params.id]);
    return reply.header("Cache-Control", "private, no-store").send({ conflicts: result.rows });
  });
}
