import { setGroupPublicSignup } from "../community/signup-form.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { addDays, calendarOccurrenceExists, cleanLocalDateTime, localDateTime, occurrenceStarts, wallDate, type Recurrence } from "../../calendar-occurrences.js";
import { appointmentWallTime, canonicalTimeZone, resolveAppointmentWallTime } from "../../calendar-time.js";
import { isServerModuleEnabled, type ModuleServerContext } from "../module-sdk.js";
import { copyRegistrationForm, createDraftRegistrationGroup, lockRegistrationTemplate } from "./registration-groups.js";

type SignupSchedule = { leadDays: number; templateGroupId?: string; autoPublish?: boolean };
type Appointment = {
  id: string; department_id: string; title: string; time_zone: string | null; site_zone: string;
  starts_at: string; recurrence: Recurrence | null; signup_group_id: string | null; internal_only: boolean; all_day: boolean;
};
type StoredSchedule = { lead_days: number; template_group_id: string | null; created_by: string | null; auto_publish: boolean };
type Occurrence = { original: string; scheduled: string; all_day: boolean };
export const signupLeadDaysSchema = { type: "integer", minimum: 0, maximum: 365 } as const;
const format = `'YYYY-MM-DD"T"HH24:MI:SS'`;

export async function setSignupSchedule(client: PoolClient, appointmentId: string, actorId: string, schedule: SignupSchedule | null) {
  if (!schedule) {
    await client.query("DELETE FROM church_calendar_signup_schedules WHERE appointment_id=$1", [appointmentId]);
    return;
  }
  await client.query(
    `INSERT INTO church_calendar_signup_schedules(appointment_id,lead_days,template_group_id,created_by,auto_publish)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(appointment_id) DO UPDATE
       SET lead_days=EXCLUDED.lead_days,template_group_id=EXCLUDED.template_group_id,created_by=EXCLUDED.created_by,auto_publish=EXCLUDED.auto_publish`,
    [appointmentId, schedule.leadDays, schedule.templateGroupId ?? null, actorId, schedule.autoPublish === true],
  );
}

const scopedAppointment = `FROM church_calendar_appointments appointment
  JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
  JOIN departments site ON site.id=appointment.department_id`;
const communityAppointment = `appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL
  AND calendar.archived_at IS NULL AND calendar.scope='community'`;

export function registerCalendarSignupSchedule(app: FastifyInstance, context: ModuleServerContext, canManage: (request: FastifyRequest) => boolean) {
  type Req = { Params: { id: string }; Body: { schedule: SignupSchedule | null } };
  const url = "/api/modules/church-calendar/appointments/:id/signup-schedule";
  const params = { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
  app.get<Req>(url, { schema: { params } }, async (request, reply) => {
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (!canManage(request)) return reply.code(403).send({ error: "Calendar and group management access is required." });
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Church Calendar is unavailable." });
    const result = await context.pool.query(
      `SELECT schedule.lead_days AS "leadDays",schedule.template_group_id AS "templateGroupId",schedule.auto_publish AS "autoPublish"
       ${scopedAppointment} LEFT JOIN church_calendar_signup_schedules schedule ON schedule.appointment_id=appointment.id
       WHERE ${communityAppointment}`, [request.params.id, departmentId],
    );
    if (!result.rows.length) return reply.code(404).send({ error: "The appointment was not found." });
    return { schedule: result.rows[0].leadDays === null ? null : result.rows[0] };
  });
  app.put<Req>(url, { schema: { params, body: {
    type: "object", additionalProperties: false, required: ["schedule"], properties: { schedule: {
      anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["leadDays"],
        properties: { leadDays: signupLeadDaysSchema, autoPublish: { type: "boolean" }, templateGroupId: { type: "string", format: "uuid" } } }],
    } },
  } } }, async (request, reply) => {
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (!canManage(request)) return reply.code(403).send({ error: "Calendar and group management access is required." });
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Church Calendar is unavailable." });
    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(423).send({ error: "This location is read-only." });
      }
      const row = (await client.query(
        `SELECT appointment.internal_only,appointment.signup_group_id,'community'=ANY(site.enabled_modules) AS "groupsEnabled"
         ${scopedAppointment} WHERE ${communityAppointment} FOR UPDATE OF appointment FOR SHARE OF calendar`, [request.params.id, departmentId],
      )).rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "The appointment was not found." });
      }
      const schedule = request.body.schedule;
      if (schedule && (row.internal_only || row.signup_group_id || !row.groupsEnabled || !isServerModuleEnabled("community"))) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Scheduling requires a community appointment without a series-wide signup link and Groups enabled." });
      }
      if (schedule?.templateGroupId) {
        const problem = await lockRegistrationTemplate(client, departmentId, schedule.templateGroupId);
        if (problem) {
          await client.query("ROLLBACK");
          return reply.code(problem.status).send({ error: problem.error });
        }
      }
      await setSignupSchedule(client, request.params.id, request.authenticatedUser!.id, schedule);
      await client.query("COMMIT");
      return { schedule };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });
}

async function canPublishScheduledSignup(client: PoolClient, departmentId: string, actorId: string) {
  const result = await client.query(
    `SELECT 1 FROM department_memberships membership JOIN app_users actor ON actor.id=membership.user_id
      WHERE membership.department_id=$1 AND membership.user_id=$2 AND actor.is_enabled AND NOT actor.is_service_user
        AND (membership.role='site_admin' OR ('groups_manage'=ANY(membership.permissions)
          AND ('events_manage'=ANY(membership.permissions) OR membership.module_permissions->'church-calendar' ? 'manage')))
      FOR SHARE OF membership,actor`,
    [departmentId, actorId],
  );
  return Boolean(result.rowCount);
}

async function publishScheduledSignup(client: PoolClient, departmentId: string, groupId: string, closesAt: Date) {
  // The native signup form retains manager review and rejects requests once its window closes.
  await client.query(
    `INSERT INTO group_signup_forms(group_id,department_id,revision,questions,closes_at)
      VALUES($1,$2,gen_random_uuid(),'[]'::jsonb,$3)
      ON CONFLICT(group_id) DO UPDATE SET closes_at=EXCLUDED.closes_at`,
    [groupId, departmentId, closesAt],
  );
  const active = await client.query("UPDATE church_groups SET status='active',updated_at=now() WHERE id=$1 AND department_id=$2 AND source_system IS NULL AND status='draft'", [groupId, departmentId]);
  if (active.rowCount !== 1 || !await setGroupPublicSignup(client, departmentId, groupId, true)) {
    throw new Error("Could not activate the scheduled registration group.");
  }
}

async function generate(client: PoolClient, appointment: Appointment, schedule: StoredSchedule, now: number) {
  if (appointment.internal_only || appointment.signup_group_id || !schedule.created_by) return 0;
  const zone = canonicalTimeZone(appointment.time_zone ?? appointment.site_zone);
  if (!zone) return 0;
  if (schedule.auto_publish && !await canPublishScheduledSignup(client, appointment.department_id, schedule.created_by)) return 0;
  const localNow = appointmentWallTime(now, zone);
  const from = localNow.slice(0, 10) + "T00:00:00";
  const through = localDateTime(addDays(wallDate(from), schedule.lead_days)).slice(0, 10) + "T23:59:59";
  const extras = (await client.query<{ original: string }>(
    `SELECT to_char(starts_at,${format}) AS original FROM church_calendar_extra_dates
       WHERE appointment_id=$1 AND starts_at BETWEEN $2::timestamp AND $3::timestamp`, [appointment.id, from, through],
  )).rows;
  const originals = [...new Set([...occurrenceStarts(appointment, from, through, 500).map(localDateTime), ...extras.map((row) => row.original)])];
  const moved = (await client.query<{ original: string; extra: boolean }>(
    `SELECT to_char(original_start,${format}) AS original,EXISTS (
       SELECT 1 FROM church_calendar_extra_dates extra WHERE extra.appointment_id=$1 AND extra.starts_at=exceptions.original_start
     ) AS extra FROM church_calendar_appointment_exceptions exceptions
     WHERE appointment_id=$1 AND overrides->>'startsAt' BETWEEN $2::text AND $3::text AND NOT cancelled`,
    [appointment.id, from, through],
  )).rows;
  for (const { original, extra } of moved) {
    if ((extra || calendarOccurrenceExists(appointment, original)) && !originals.includes(original)) originals.push(original);
  }
  if (!originals.length) return 0;
  const candidates = (await client.query<Occurrence>(
    `SELECT original,coalesce(exceptions.overrides->>'startsAt',original) AS scheduled,
          coalesce((exceptions.overrides->>'allDay')::boolean,$3) AS all_day
      FROM unnest($2::text[]) AS dates(original)
      LEFT JOIN church_calendar_appointment_exceptions exceptions ON exceptions.appointment_id=$1 AND exceptions.original_start=original::timestamp
      WHERE NOT coalesce(exceptions.cancelled,false) AND NOT coalesce((exceptions.overrides->>'internalOnly')::boolean,false)
        AND exceptions.overrides->>'signupGroupId' IS NULL ORDER BY original`, [appointment.id, originals, appointment.all_day],
  )).rows;
  const due: Array<Occurrence & { closesAt: Date | null }> = [];
  for (const candidate of candidates) {
    const start = cleanLocalDateTime(candidate.scheduled);
    if (!start || start < (candidate.all_day ? from : localNow) || start > through) continue;
    let closesAt: Date | null = null;
    if (schedule.auto_publish) {
      const closeWallTime = candidate.all_day
        ? localDateTime(addDays(wallDate(start.slice(0, 10) + "T00:00:00"), 1))
        : start;
      const close = resolveAppointmentWallTime(closeWallTime, zone);
      if (!close || close.instant <= now) continue;
      closesAt = new Date(close.instant);
    }
    due.push({ ...candidate, closesAt });
    if (due.length === 100) break;
  }
  if (!due.length) return 0;
  if (schedule.template_group_id && await lockRegistrationTemplate(client, appointment.department_id, schedule.template_group_id)) return 0;
  await client.query("SELECT set_config('smart_church.actor_id',$1,true)", [schedule.created_by]);
  const created: string[] = [];
  const toPublish: Array<{ id: string; closesAt: Date }> = [];
  for (const { original, scheduled, closesAt } of due) {
    const groupId = await createDraftRegistrationGroup(client, appointment.department_id, appointment.id, appointment.title, scheduled, original);
    if (!appointment.recurrence && original === appointment.starts_at && scheduled === original) {
      await client.query("UPDATE church_calendar_appointments SET signup_group_id=$2,updated_at=now() WHERE id=$1", [appointment.id, groupId]);
    } else await client.query(
      `INSERT INTO church_calendar_appointment_exceptions(appointment_id,original_start,cancelled,overrides,updated_by)
        VALUES($1,$2::timestamp,false,jsonb_build_object('signupGroupId',$3::text),$4)
        ON CONFLICT(appointment_id,original_start) DO UPDATE SET overrides=church_calendar_appointment_exceptions.overrides || EXCLUDED.overrides,
          updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [appointment.id, original, groupId, schedule.created_by],
    );
    created.push(groupId);
    if (closesAt) toPublish.push({ id: groupId, closesAt });
  }
  if (schedule.template_group_id) await copyRegistrationForm(client, appointment.department_id, schedule.template_group_id, created);
  for (const { id, closesAt } of toPublish) await publishScheduledSignup(client, appointment.department_id, id, closesAt);
  return created.length;
}

export async function runScheduledCalendarSignupGroups(context: ModuleServerContext, now: number, onError: (error: unknown) => void) {
  const { pool } = context;
  if (!pool || !context.isDatabaseReady() || !isServerModuleEnabled("church-calendar") || !isServerModuleEnabled("community")) return;
  const candidates = (await pool.query<{ id: string; department_id: string }>(
    `SELECT appointment.id,appointment.department_id FROM church_calendar_signup_schedules schedule
     JOIN church_calendar_appointments appointment ON appointment.id=schedule.appointment_id
     JOIN departments site ON site.id=appointment.department_id
     WHERE appointment.archived_at IS NULL AND 'community'=ANY(site.enabled_modules) AND 'church-calendar'=ANY(site.enabled_modules)
     ORDER BY appointment.id`,
  )).rows;
  for (const { id, department_id } of candidates) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, department_id)) {
        await client.query("ROLLBACK");
        continue;
      }
      const appointment = (await client.query<Appointment>(
        `SELECT appointment.id,appointment.department_id,appointment.title,appointment.time_zone,
                site.time_zone AS site_zone,to_char(appointment.starts_at,${format}) AS starts_at,
                appointment.recurrence,appointment.signup_group_id,appointment.internal_only,appointment.all_day
         ${scopedAppointment} WHERE ${communityAppointment} AND 'community'=ANY(site.enabled_modules) AND 'church-calendar'=ANY(site.enabled_modules)
         FOR UPDATE OF appointment FOR SHARE OF calendar`, [id, department_id],
      )).rows[0];
      const schedule = (await client.query<StoredSchedule>(
        "SELECT lead_days,template_group_id,created_by,auto_publish FROM church_calendar_signup_schedules WHERE appointment_id=$1 FOR SHARE", [id],
      )).rows[0];
      const created = appointment && schedule ? await generate(client, appointment, schedule, now) : 0;
      await client.query("COMMIT");
      if (created) {
        context.realtime.publish("module:church-calendar:changed", department_id, { action: "registration-groups-scheduled", appointmentId: id, created });
        context.realtime.publish("core:groups:changed", department_id, { action: "registration-groups-scheduled", created });
      }
    } catch (error) {
      await client.query("ROLLBACK");
      onError(error);
    } finally { client.release(); }
  }
}

export function startCalendarSignupWorker(app: FastifyInstance, context: ModuleServerContext) {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  app.addHook("onReady", async () => {
    const onError = (err: unknown) => app.log.error({ err }, "Calendar could not generate scheduled registration groups.");
    timer = setInterval(() => {
      if (running) return;
      running = runScheduledCalendarSignupGroups(context, Date.now(), onError).catch(onError).finally(() => { running = undefined; });
    }, 60_000);
    timer.unref();
  });
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await running;
  });
}
