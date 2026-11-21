import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { canonicalTimeZone } from "./calendar-time.js";
import { describeTimedVolunteerAbsence, parseTimedVolunteerAbsence, volunteerEventWindow } from "./volunteer-absence-time.js";

type Scope = (request: FastifyRequest, reply: FastifyReply, manage: boolean) => Promise<string | null>;
type Dependencies = { pool: Pool | null; available: () => boolean; resolveScope: Scope;
  validateMutation: (request: FastifyRequest, reply: FastifyReply) => boolean;
  lockDepartmentForWrite: (db: PoolClient, departmentId: string) => Promise<boolean> };
type Range = { startsOn: string; endsOn: string };
type ConsentInput = Range & { allowTimed?: boolean };
type TimedInput = { startsAt: string; endsAt: string };
type AbsenceInput = Range | TimedInput;
type Row = Range & { id: string; startsAtUtc: string | null; endsAtUtc: string | null };
type Queryable = Pick<PoolClient, "query">;
const path = "/api/events/volunteer-absences";
const localPerson = `SELECT c.id FROM department_memberships m JOIN contacts c
  ON c.id=m.contact_id AND c.department_id=m.department_id AND c.archived_at IS NULL
  WHERE m.department_id=$1 AND m.user_id=$2`;
const storedDates = `starts_on::text AS "startsOn",ends_on::text AS "endsOn",
  to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "startsAtUtc",
  to_char(ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "endsAtUtc"`;
const params = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const body = { type: "object", additionalProperties: false, required: ["startsOn", "endsOn"],
  properties: { startsOn: { type: "string", format: "date" }, endsOn: { type: "string", format: "date" } } } as const;

const absenceBody = { oneOf: [body, {
  type: "object", additionalProperties: false, required: ["startsAt", "endsAt"],
  properties: { startsAt: { type: "string", maxLength: 19 }, endsAt: { type: "string", maxLength: 19 } },
}] } as const;

async function absenceZone(db: Queryable, departmentId: string, lock = false) {
  const { rows: [site] } = await db.query<{ time_zone: string }>(
    "SELECT time_zone FROM departments WHERE id=$1" + (lock ? " FOR SHARE" : ""), [departmentId]);
  return canonicalTimeZone(site?.time_zone);
}
function storedAbsence(row: Row, timeZone: string) {
  const { id, startsOn, endsOn, startsAtUtc, endsAtUtc } = row;
  return startsAtUtc && endsAtUtc ? { id, ...describeTimedVolunteerAbsence(startsAtUtc, endsAtUtc, timeZone), startsAtUtc, endsAtUtc }
    : { id, startsOn, endsOn };
}

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
    const [owner, timeZone] = await Promise.all([pool!.query<{ id: string }>(localPerson, [departmentId, actor]), absenceZone(pool!, departmentId)]);
    const person = owner.rows[0];
    const result = person ? await pool!.query<Row>(`SELECT id,${storedDates} FROM event_volunteer_absences
      WHERE department_id=$1 AND contact_id=$3 AND contact_id=(${localPerson}) ORDER BY starts_on,starts_at NULLS FIRST,ends_on,id`, [departmentId, actor, person.id]) : { rows: [] };
    return reply.header("Cache-Control", "private, no-store").send({
      linked: !!person, timeZone, rows: result.rows.map((row) => storedAbsence(row, timeZone ?? "UTC")),
    });
  });
  async function mutate(request: FastifyRequest, reply: FastifyReply, id: string | undefined, input: AbsenceInput | undefined) {
    const departmentId = await scope(request, reply);
    if (!departmentId || !deps.validateMutation(request, reply)) return reply;

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
      const timeZone = input ? await absenceZone(db, departmentId, true) : null;
      const timed = input && "startsAt" in input;
      const previous = timed && id ? (await db.query<Row>(`SELECT id,${storedDates}
        FROM event_volunteer_absences WHERE department_id=$1 AND contact_id=$2 AND id=$3 FOR UPDATE`,
      [departmentId, person.id, id])).rows[0] : undefined;
      const range = timed && timeZone ? parseTimedVolunteerAbsence(input.startsAt, input.endsAt, timeZone, previous)
        : input && "startsOn" in input ? { ...input, startsAtUtc: null, endsAtUtc: null } : null;
      if (input && (!range || !validVolunteerAbsenceRange(range))) {
        await db.query("ROLLBACK");
        return reply.code(400).send({ error: timed ? "Choose a valid time range in the location’s time zone, up to 366 calendar days."
          : "Choose a date range of up to 366 calendar days." });
      }
      const key = [departmentId, person.id, id ?? randomUUID()];
      const values = range ? [...key, range.startsOn, range.endsOn, range.startsAtUtc, range.endsAtUtc] : key;
      const result = range
        ? id
          ? await db.query<Row>(`UPDATE event_volunteer_absences SET starts_on=$4,ends_on=$5,starts_at=$6,ends_at=$7,updated_at=now()
              WHERE department_id=$1 AND contact_id=$2 AND id=$3 RETURNING id,${storedDates}`, values)
          : await db.query<Row>(`INSERT INTO event_volunteer_absences(department_id,contact_id,id,starts_on,ends_on,starts_at,ends_at)
              VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,${storedDates}`, values)
        : await db.query<Row>(`DELETE FROM event_volunteer_absences WHERE department_id=$1 AND contact_id=$2 AND id=$3
            RETURNING id,${storedDates}`, key);
      if (!result.rowCount) {
        await db.query("ROLLBACK");
        return reply.code(404).send({ error: "This absence could not be found." });
      }
      await db.query("COMMIT");
      return reply.code(range && !id ? 201 : 200).header("Cache-Control", "private, no-store").send(range ? storedAbsence(result.rows[0], timeZone ?? "UTC") : { deleted: true });
    } catch (error) {
      await db.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        return reply.code(409).send({ error: "This exact absence is already recorded." });
      }
      throw error;
    } finally { db.release(); }
  }
  app.post<{ Body: AbsenceInput }>(path, { schema: { body: absenceBody } }, (request, reply) => mutate(request, reply, undefined, request.body));
  app.put<{ Params: { id: string }; Body: AbsenceInput }>(`${path}/:id`, { schema: { params, body: absenceBody } }, (request, reply) => mutate(request, reply, request.params.id, request.body));
  app.delete<{ Params: { id: string } }>(`${path}/:id`, { schema: { params } }, (request, reply) => mutate(request, reply, request.params.id, undefined));

  const consentPath = `${path}/churchtools-consent`;
  const importIdentity = `SELECT config.instance_url AS "instanceUrl",proof.source_person_id AS "sourcePersonId"
    FROM churchtools_sync_settings config
    JOIN churchtools_migration_person_provenance proof ON proof.department_id=config.department_id AND proof.instance_url=config.instance_url
    WHERE config.department_id=$1 AND proof.contact_id=$2`;
  app.get(consentPath, async (request, reply) => {
    const departmentId = await scope(request, reply);
    if (!departmentId) return reply;
    const actor = request.authenticatedUser!.id;
    const { rows: [result] } = await pool!.query<{ startsOn: string | null; endsOn: string | null; allowTimed: boolean | null; timedZone: string | null }>(`SELECT
      consent.starts_on::text AS "startsOn",consent.ends_on::text AS "endsOn",consent.allow_timed AS "allowTimed",consent.timed_zone AS "timedZone"
      FROM (${localPerson}) person
      JOIN churchtools_migration_person_provenance proof ON proof.department_id=$1 AND proof.contact_id=person.id
      JOIN churchtools_sync_settings config ON config.department_id=proof.department_id AND config.instance_url=proof.instance_url
      LEFT JOIN event_volunteer_absence_import_consents consent ON consent.department_id=$1 AND consent.contact_id=person.id
        AND consent.actor_user_id=$2 AND consent.instance_url=proof.instance_url AND consent.source_person_id=proof.source_person_id`, [departmentId, actor]);
    return reply.header("Cache-Control", "private, no-store").send({
      available: !!result, allowTimed: result?.allowTimed === true && result.timedZone === await absenceZone(pool!, departmentId), range: result?.startsOn && result.endsOn ? { startsOn: result.startsOn, endsOn: result.endsOn } : null,
    });
  });
  async function mutateConsent(request: FastifyRequest, reply: FastifyReply, range?: ConsentInput) {
    const departmentId = await scope(request, reply);
    if (!departmentId || !deps.validateMutation(request, reply)) return reply;
    if (range && !validVolunteerAbsenceRange(range)) return reply.code(400).send({ error: "Choose a date range of up to 366 calendar days." });
    const actor = request.authenticatedUser!.id;
    const db = await pool!.connect();
    try {
      await db.query("BEGIN");
      if (!await deps.lockDepartmentForWrite(db, departmentId)) {
        await db.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const { rows: [person] } = await db.query<{ id: string }>(localPerson + " FOR SHARE OF m,c", [departmentId, actor]);
      if (!person) {
        await db.query("ROLLBACK");
        return reply.code(403).send({ error: "Link your account to a People record at this location first." });
      }
      if (range) {
        const { rows: [verified] } = await db.query<{ instanceUrl: string; sourcePersonId: string }>(
          importIdentity + " FOR SHARE OF config,proof", [departmentId, person.id]);
        if (!verified) {
          await db.query("ROLLBACK");
          return reply.code(409).send({ error: "This People record needs a verified ChurchTools connection." });
        }
        const timedZone = range.allowTimed ? await absenceZone(db, departmentId, true) : null;
        if (range.allowTimed && !timedZone) {
          await db.query("ROLLBACK");
          return reply.code(400).send({ error: "A valid location time zone is required to allow timed imports." });
        }
        await db.query(`INSERT INTO event_volunteer_absence_import_consents
          (department_id,contact_id,actor_user_id,instance_url,source_person_id,starts_on,ends_on,allow_timed,timed_zone)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(department_id,contact_id) DO UPDATE SET
          actor_user_id=EXCLUDED.actor_user_id,instance_url=EXCLUDED.instance_url,source_person_id=EXCLUDED.source_person_id,
          starts_on=EXCLUDED.starts_on,ends_on=EXCLUDED.ends_on,allow_timed=EXCLUDED.allow_timed,timed_zone=EXCLUDED.timed_zone,consented_at=now()`,
        [departmentId, person.id, actor, verified.instanceUrl, verified.sourcePersonId, range.startsOn, range.endsOn, range.allowTimed === true, timedZone]);
      } else {
        await db.query("DELETE FROM event_volunteer_absence_import_consents WHERE department_id=$1 AND contact_id=$2 AND actor_user_id=$3",
          [departmentId, person.id, actor]);
      }
      await db.query("COMMIT");
      return reply.header("Cache-Control", "private, no-store").send({ range: range ? { startsOn: range.startsOn, endsOn: range.endsOn } : null, allowTimed: range?.allowTimed === true });
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    finally { db.release(); }
  }
  app.put<{ Body: ConsentInput }>(consentPath, { schema: { body: {
    ...body, properties: { ...body.properties, allowTimed: { type: "boolean" } },
  } } }, (request, reply) => mutateConsent(request, reply, request.body));
  app.delete(consentPath, (request, reply) => mutateConsent(request, reply));

  app.get<{ Params: { id: string } }>("/api/events/:id/volunteer-conflicts", { schema: { params } }, async (request, reply) => {
    const departmentId = await scope(request, reply, true);
    if (!departmentId) return reply;
    const { rows: [event] } = await pool!.query<{ date: string; allDay: boolean; from: string | null; to: string | null; zone: string }>(`
      SELECT e.event_date::text AS date,e.is_all_day AS "allDay",to_char(e.start_time,'HH24:MI:SS') AS "from",
        to_char(e.end_time,'HH24:MI:SS') AS "to",d.time_zone AS zone
      FROM service_events e JOIN departments d ON d.id=e.department_id
      WHERE e.department_id=$1 AND e.id=$2 AND e.cancelled_at IS NULL`, [departmentId, request.params.id]);
    const zone = event && canonicalTimeZone(event.zone);
    const window = event && zone ? volunteerEventWindow(event.date, event.allDay, event.from, event.to, zone) : null;
    const result = await pool!.query<{ positionIndex: number; name: string }>(`SELECT (position.ordinality - 1)::int AS "positionIndex",position.data->>'name' AS name
      FROM service_events event CROSS JOIN LATERAL jsonb_array_elements(event.positions) WITH ORDINALITY position(data,ordinality)
      WHERE event.department_id=$1 AND event.id=$2 AND event.cancelled_at IS NULL AND EXISTS (
        SELECT 1 FROM event_volunteer_absences absence JOIN contacts c
          ON c.id=absence.contact_id AND c.department_id=absence.department_id AND c.archived_at IS NULL
        WHERE absence.department_id=event.department_id AND absence.contact_id::text=position.data->>'contactId'
          AND ((absence.starts_at IS NULL AND event.event_date BETWEEN absence.starts_on AND absence.ends_on)
            OR (absence.starts_at IS NOT NULL AND $3::timestamptz IS NOT NULL AND absence.ends_at>$3::timestamptz
              AND (($4::timestamptz IS NULL AND absence.starts_at<=$3::timestamptz) OR absence.starts_at<$4::timestamptz))))
      ORDER BY position.ordinality`, [departmentId, request.params.id, window?.startsAtUtc ?? null, window?.endsAtUtc ?? null]);
    return reply.header("Cache-Control", "private, no-store").send({ conflicts: result.rows });
  });
}
