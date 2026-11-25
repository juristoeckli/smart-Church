import type { FastifyInstance, FastifyRequest } from "fastify";
import { addDays, calendarOccurrenceExists, cleanLocalDateTime, localDateTime, occurrenceStarts, startOfDay, type Recurrence } from "../../calendar-occurrences.js";
import { appointmentWallTime, canonicalTimeZone } from "../../calendar-time.js";
import type { ModuleServerContext } from "../module-sdk.js";

type Exception = { original: string; cancelled: boolean; overrides: Record<string, unknown> };
type Appointment = {
  id: string;
  title: string;
  calendar_name: string;
  starts_at: string;
  recurrence: Recurrence | null;
  time_zone: string | null;
  site_zone: string;
  signup_group_id: string | null;
  exceptions: Exception[];
  extra_dates: string[];
};
type Target = { appointmentId: string; originalStartAt: string; date: string; title: string; calendarName: string };

function linkedTargets(appointment: Appointment, groupId: string, now: number): Target[] {
  const extraDates = new Set(appointment.extra_dates);
  const byOriginal = new Map(appointment.exceptions.map((entry) => [entry.original, entry]));
  function target(originalStartAt: string): Target | null {
    const exception = byOriginal.get(originalStartAt);
    if (exception?.cancelled) return null;
    const fields = exception?.overrides ?? {};
    const signupGroup = Object.hasOwn(fields, "signupGroupId") ? fields.signupGroupId : appointment.signup_group_id;
    if (signupGroup !== groupId) return null;
    const start = cleanLocalDateTime(fields.startsAt) ?? originalStartAt;
    return { appointmentId: appointment.id, originalStartAt, date: start.slice(0, 10),
      title: typeof fields.title === "string" ? fields.title : appointment.title, calendarName: appointment.calendar_name };
  }

  const exact = appointment.exceptions.filter((entry) => entry.overrides.signupGroupId === groupId &&
    (extraDates.has(entry.original) || calendarOccurrenceExists(appointment, entry.original)))
    .map(({ original }) => target(original)).filter((value): value is Target => value !== null);
  if (appointment.signup_group_id !== groupId) return exact;

  const zone = canonicalTimeZone(appointment.time_zone ?? appointment.site_zone) ?? "UTC";
  const today = appointmentWallTime(now, zone).slice(0, 10);
  const first = startOfDay(appointment.starts_at);
  const recent = startOfDay(today);
  const candidates = new Set([...extraDates,
    ...occurrenceStarts(appointment, localDateTime(recent), localDateTime(addDays(recent, 366)), 500).map(localDateTime),
    ...occurrenceStarts(appointment, localDateTime(first), localDateTime(addDays(first, 366)), 500).map(localDateTime),
  ]);
  const inherited = [...candidates].filter((original) => !Object.hasOwn(byOriginal.get(original)?.overrides ?? {}, "signupGroupId"))
    .map(target).filter((value): value is Target => value !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.originalStartAt.localeCompare(b.originalStartAt));
  const representative = inherited.find((entry) => entry.date >= today) ?? inherited.at(-1);
  return representative ? [...exact, representative] : exact;
}

export function registerSignupAppointmentLinks(app: FastifyInstance, context: ModuleServerContext, hasGroupVisibility: (request: FastifyRequest) => boolean) {
  app.get<{ Params: { id: string } }>("/api/modules/church-calendar/signup-groups/:id/appointments", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return reply.code(503).send({ error: "Church Calendar is unavailable." });
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const groupId = request.params.id.toLowerCase();
    reply.header("Cache-Control", "private, no-store");
    const { rows } = await context.pool.query<Appointment>(
      `SELECT appointment.id,appointment.title,calendar.name AS calendar_name,appointment.recurrence,
              appointment.time_zone,site.time_zone AS site_zone,appointment.signup_group_id,
              to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('original',to_char(exception.original_start,'YYYY-MM-DD"T"HH24:MI:SS'),
                          'cancelled',exception.cancelled,'overrides',exception.overrides))
                FROM church_calendar_appointment_exceptions exception WHERE exception.appointment_id=appointment.id),'[]'::jsonb) AS exceptions,
              COALESCE((SELECT array_agg(to_char(extra.starts_at,'YYYY-MM-DD"T"HH24:MI:SS'))
                FROM church_calendar_extra_dates extra WHERE extra.appointment_id=appointment.id),ARRAY[]::text[]) AS extra_dates
         FROM church_groups groups
         JOIN departments site ON site.id=groups.department_id
         JOIN church_calendar_appointments appointment ON appointment.department_id=groups.department_id
         JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
        WHERE groups.id=$1 AND groups.department_id=$2 AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL
          AND (calendar.scope='community' OR calendar.owner_user_id=$3 OR (calendar.scope='group' AND ($4 OR EXISTS (
            SELECT 1 FROM department_memberships membership JOIN group_members member ON member.contact_id=membership.contact_id
             WHERE membership.user_id=$3 AND membership.department_id=$2 AND member.group_id=calendar.group_id AND member.status='active'))))
          AND (appointment.signup_group_id=$1 OR EXISTS (SELECT 1 FROM church_calendar_appointment_exceptions linked
            WHERE linked.appointment_id=appointment.id AND NOT linked.cancelled AND linked.overrides->>'signupGroupId'=$1::uuid::text))
        ORDER BY appointment.starts_at DESC,appointment.id LIMIT 100`,
      [groupId, departmentId, request.authenticatedUser!.id, hasGroupVisibility(request)],
    );
    const now = Date.now();
    return rows.flatMap((appointment) => linkedTargets(appointment, groupId, now))
      .sort((a, b) => a.date.localeCompare(b.date) || a.originalStartAt.localeCompare(b.originalStartAt) || a.appointmentId.localeCompare(b.appointmentId)).slice(0, 50);
  });
}
