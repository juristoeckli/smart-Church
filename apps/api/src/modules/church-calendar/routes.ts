import { registerCalendarRemoval } from "./remove-appointment.js";
import { registerCalendarBookingDecisions } from "./booking-decisions.js";
import { addResourcesToNewCalendarAppointment, type CalendarCreatedBooking } from "./new-appointment-resources.js";
import { resourceSelectionListSchema, type ResourceSelection } from "../../resource-booking-series-write.js";
import { calendarImageMetadataSchema, defaultCalendarImageMetadata, normalizeCalendarImageMetadata, type CalendarImageMetadata } from "./image-metadata.js";
import { registerCalendarEmailSubscriptions } from "./email-subscriptions.js";
import { registerCalendarBookingDescriptions } from "./booking-descriptions.js";
import { loadPublicAgenda, registerCalendarAgendaPublications } from "./calendar-agenda-publications.js";
import { calendarEmbedContentPolicy, renderCalendarEmbed, type EmbedAppointment, type EmbedSettings } from "./calendar-embed.js";
import { registerCalendarTagDefinitions } from "./tag-definitions.js";
import { loadOccurrenceRequestScope, occurrenceRequestKey, registerCalendarMeetingRequests } from "./meeting-requests.js";
import { foldIcsLine, hashFeedToken, icsEscape } from "../../calendar-feed-format.js";
import { isResourceBookingManager } from "../../resource-booking-policy.js";
import { registerAppointmentTemplates } from "./appointment-templates.js";
import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { ServicePlanTemplate } from "@smart-church/contracts";
import { registerCalendarReplication } from "./replication.js";
import { isServerModuleEnabled, type ModuleServerContext } from "../module-sdk.js";
import { calendarReminderOccurrence, calendarReminderWindow, type CalendarReminderSchedule } from "../../calendar-reminders.js";
import { appointmentInstants, appointmentWallTime, canonicalTimeZone } from "../../calendar-time.js";
import { addDays, calendarBookingWindow, calendarOccurrenceExists, cleanLocalDateTime, localDateTime, occurrenceStarts, startOfDay, wallDate, type Recurrence } from "../../calendar-occurrences.js";

import { planCalendarSeriesSplit, type ExplicitDate } from "../../calendar-series-split.js";

type CalendarScope = "community" | "group" | "personal";
type AppointmentInput = {
  calendarId: string; title: string; subtitle?: string; description?: string; startsAt: string; endsAt: string; allDay?: boolean;
  place?: string; url?: string; internalOnly?: boolean; tags?: string[]; recurrence?: Recurrence | null; linkedEventId?: string | null;
  resourceBookingIds?: string[]; signupGroupId?: string | null; responsibleContactId?: string | null; timeZone?: string | null;
};
type AppointmentRow = {
  id: string; calendar_id: string; title: string; subtitle: string; description: string; starts_at: string; ends_at: string;
  all_day: boolean; place: string; url: string; internal_only: boolean; tags: string[]; recurrence: Recurrence | null;
  linked_event_id: string | null; created_by: string | null; calendar_scope: CalendarScope; calendar_name: string; responsible_contact_id?: string | null; responsible_name?: string | null;
  owner_user_id: string | null; group_id: string | null; signup_group_id?: string | null; has_image?: boolean;
  time_zone?: string | null; location_time_zone?: string;
};
type Occurrence = Record<string, unknown> & {
  appointmentId: string; occurrenceStartAt: string; occurrenceEndAt: string;
  startsAtUtc?: string | null; viewStartsAt?: string; viewEndsAt?: string; allDay?: boolean;
};

const calendarFields = ["title", "subtitle", "description", "startsAt", "endsAt", "allDay", "place", "url", "internalOnly", "tags", "linkedEventId", "signupGroupId", "responsibleContactId"] as const;

function normalizeInput(input: AppointmentInput): AppointmentInput | string {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const startsAt = cleanLocalDateTime(input.startsAt);
  const endsAt = cleanLocalDateTime(input.endsAt);
  if (!title || title.length > 160) return "Enter an appointment title up to 160 characters.";
  if (!startsAt || !endsAt || endsAt < startsAt) return "Choose valid start and end times.";
  const timeZone = input.timeZone == null ? input.timeZone : canonicalTimeZone(input.timeZone);
  if (input.timeZone != null && !timeZone) return "Choose a valid named time zone.";
  if (typeof input.calendarId !== "string") return "Choose a calendar.";
  if (input.signupGroupId != null && (typeof input.signupGroupId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.signupGroupId))) return "Choose a valid public-signup group.";
  if (input.responsibleContactId != null && (typeof input.responsibleContactId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.responsibleContactId))) return "Choose a valid responsible person.";
  const recurrence = input.recurrence ?? null;
  if (recurrence) {
    if (!["daily", "weekly", "monthly", "monthly_weekday", "yearly", "manual"].includes(recurrence.frequency)) return "Choose a supported repeat pattern.";
    if (recurrence.endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(recurrence.endsOn)) return "Choose a valid recurrence end date.";
    if (recurrence.count !== undefined && (!Number.isInteger(recurrence.count) || recurrence.count < 1 || recurrence.count > 500)) return "Repeat count must be between 1 and 500.";
    if (recurrence.frequency === "manual" && (!Array.isArray(recurrence.dates) || recurrence.dates.length > 100 || recurrence.dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date)))) return "Add up to 100 valid dates for a manual repeat.";
    if (recurrence.frequency === "monthly_weekday" && (!Number.isInteger(recurrence.weekday) || recurrence.weekday! < 0 || recurrence.weekday! > 6 || ![-1, 1, 2, 3, 4].includes(Number(recurrence.weekOfMonth)))) return "Choose a valid weekday and week of the month, including last.";
    if (recurrence.frequency === "monthly_weekday") {
      const initial = new Date(`${startsAt.slice(0, 10)}T00:00:00Z`);
      const ordinalMatches = recurrence.weekOfMonth === -1
        ? addDays(initial, 7).getUTCMonth() !== initial.getUTCMonth()
        : Math.floor((initial.getUTCDate() - 1) / 7) + 1 === recurrence.weekOfMonth;
      if (initial.getUTCDay() !== recurrence.weekday || !ordinalMatches) return "The appointment start date must match the selected monthly weekday.";
    }
  }
  const tags = Array.isArray(input.tags) ? [...new Set(input.tags.map((tag) => String(tag).trim().slice(0, 40)).filter(Boolean))].slice(0, 30) : [];
  return {
    ...input, ...(input.timeZone !== undefined ? { timeZone } : {}), title, startsAt, endsAt, subtitle: String(input.subtitle ?? "").trim().slice(0, 240), description: String(input.description ?? "").trim().slice(0, 8000),
    place: String(input.place ?? "").trim().slice(0, 200), url: String(input.url ?? "").trim().slice(0, 1000), tags,
    recurrence: recurrence ? { frequency: recurrence.frequency, interval: Math.min(365, Math.max(1, Math.floor(Number(recurrence.interval) || 1))), weekdays: [...new Set((recurrence.weekdays ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))], ...(recurrence.frequency === "monthly_weekday" ? { weekday: recurrence.weekday, weekOfMonth: recurrence.weekOfMonth } : {}), endsOn: recurrence.endsOn, count: recurrence.count, dates: recurrence.dates } : null,
  };
}

function validAppointmentTimes(input: Pick<AppointmentInput, "startsAt" | "endsAt" | "allDay">, timeZone: string | null) {
  return !timeZone || input.allDay || appointmentInstants(input.startsAt, input.endsAt, timeZone)?.shifted === false;
}

async function loadCalendarEventTemplate(client: PoolClient, departmentId: string, templateId: string) {
  const templateResult = await client.query<{ positions: unknown; items: unknown }>("SELECT positions,items FROM service_plan_templates WHERE id=$1 AND department_id=$2 AND active=true FOR SHARE", [templateId, departmentId]);
  const template = templateResult.rows[0];
  if (!template) { return { status: 404, error: "Active service-plan template not found in this location." } as const; }
  const validPosition = (item: unknown): item is ServicePlanTemplate["positions"][number] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const position = item as Record<string, unknown>;
    return typeof position.name === "string" && Boolean(position.name.trim()) && position.name.length <= 80
      && (position.category === undefined || (typeof position.category === "string" && position.category.length <= 80))
      && (position.swapAllowed === undefined || typeof position.swapAllowed === "boolean")
      && (position.qualificationIds === undefined || (Array.isArray(position.qualificationIds) && position.qualificationIds.length <= 20
        && position.qualificationIds.every((value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))));
  };
  const validItem = (item: unknown): item is Record<string, unknown> => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const value = item as Record<string, unknown>;
    const allowed = new Set(["title", "startTime", "durationMinutes", "notes", "songId", "arrangementId", "position", "section"]);
    if (Object.keys(value).some((key) => !allowed.has(key))) return false;
    return typeof value.title === "string" && value.title.trim().length > 0 && value.title.length <= 160
      && (value.startTime === undefined || (typeof value.startTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.startTime)))
      && (value.durationMinutes === undefined || (Number.isInteger(value.durationMinutes) && Number(value.durationMinutes) >= 1 && Number(value.durationMinutes) <= 1440))
      && (value.notes === undefined || (typeof value.notes === "string" && value.notes.length <= 500))
      && (value.songId === undefined || (typeof value.songId === "string" && /^[0-9a-f-]{36}$/i.test(value.songId)))
      && (value.section === undefined || (typeof value.section === "string" && value.section.length <= 80))
      && (value.arrangementId === undefined || (typeof value.arrangementId === "string" && /^[0-9a-f-]{36}$/i.test(value.arrangementId)))
      && (value.position === undefined || (typeof value.position === "string" && value.position.length <= 80));
  };
  if (!Array.isArray(template.positions) || template.positions.length > 40 || !template.positions.every(validPosition)
    || !Array.isArray(template.items) || template.items.length > 100 || !template.items.every(validItem)) {
    return { status: 409, error: "The selected service-plan template has invalid or unsupported content. Review and save the template before generating events." } as const;
  }
  const positions = template.positions.map((item) => ({
    name: item.name.trim(),
    ...(item.category?.trim() ? { category: item.category.trim() } : {}),
    ...(item.swapAllowed === false ? { swapAllowed: false } : {}),
    ...(item.qualificationIds?.length ? { qualificationIds: [...new Set(item.qualificationIds.map((id) => id.toLowerCase()))] } : {}),
  }));
  const qualificationIds = [...new Set(positions.flatMap((position) => position.qualificationIds ?? []))];
  if (qualificationIds.length) {
    const available = await client.query(
      "SELECT id FROM service_volunteer_qualifications WHERE department_id=$1 AND active=true AND id=ANY($2::uuid[]) FOR SHARE",
      [departmentId, qualificationIds],
    );
    if (available.rowCount !== qualificationIds.length) {
      return { status: 409, error: "The template requires a volunteer qualification that is no longer active at this location. Update the template before generating events." } as const;
    }
  }
  const items = template.items;
  const positionNames = new Set(positions.map((position) => position.name.trim().toLocaleLowerCase()));
  if (items.some((item) => typeof item.position === "string" && item.position.trim() && !positionNames.has(item.position.trim().toLocaleLowerCase()))) { return { status: 409, error: "The selected template has plan items assigned to a role that is not present in the template." } as const; }
  const songIds = [...new Set(items.flatMap((item) => typeof item.songId === "string" && /^[0-9a-f-]{36}$/i.test(item.songId) ? [item.songId] : []))];
  const arrangementRows = items.flatMap((item) => typeof item.songId === "string" && typeof item.arrangementId === "string" ? [{ songId: item.songId, arrangementId: item.arrangementId }] : []);
  if (items.some((item) => item.arrangementId && !item.songId)) { return { status: 409, error: "The selected template has an arrangement without a song." } as const; }
  if (songIds.length) {
    const songs = await client.query("SELECT id FROM worship_songs WHERE department_id=$1 AND id=ANY($2::uuid[])", [departmentId, songIds]);
    if (songs.rowCount !== songIds.length) { return { status: 409, error: "The selected template contains a song outside this location." } as const; }
  }
  if (arrangementRows.length) {
    const arrangements = await client.query(`SELECT selected."arrangementId" FROM jsonb_to_recordset($2::jsonb) AS selected("songId" uuid,"arrangementId" uuid)
      JOIN worship_songs song ON song.id=selected."songId" AND song.department_id=$1
      JOIN worship_song_arrangements arrangement ON arrangement.id=selected."arrangementId" AND arrangement.song_id=song.id`, [departmentId, JSON.stringify(arrangementRows)]);
    if (arrangements.rowCount !== arrangementRows.length) { return { status: 409, error: "The selected template contains an arrangement that does not belong to its song." } as const; }
  }
  return { positions, items, qualificationIds };
}

const invalidAppointmentTime = "A start or end time does not exist in the selected time zone. Choose another clock time.";

function canManageCalendar(request: FastifyRequest, scope: CalendarScope, ownerId: string | null) {
  if (scope === "personal") return ownerId === request.authenticatedUser?.id;
  if (request.activeDepartmentRole === "site_admin") return true;
  if ((request.activeDepartmentModulePermissions?.["church-calendar"] ?? []).includes("manage")) return true;
  const permissions = request.activeDepartmentPermissions ?? [];
  return scope === "group" ? permissions.includes("groups_manage") || permissions.includes("events_manage") : permissions.includes("events_manage");
}

function canManageServiceEvents(request: FastifyRequest) {
  return request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("events_manage");
}

function canSeePrivatePeople(request: FastifyRequest) {
  return request.activeDepartmentRole === "site_admin"
    || (request.activeDepartmentPermissions ?? []).some((permission) => permission === "people_view_private" || permission === "people_manage");
}

function hasGroupVisibility(request: FastifyRequest) {
  return request.activeDepartmentRole === "site_admin" || (request.activeDepartmentModulePermissions?.["church-calendar"] ?? []).includes("manage") || (request.activeDepartmentPermissions ?? []).some((permission) => permission === "groups_manage" || permission === "events_manage");
}

function responseError(reply: { code: (status: number) => { send: (body: object) => unknown } }, status: number, message: string) {
  return reply.code(status).send({ error: message });
}

function icsDateTime(value: string) { return value.replace(/[-:]/g, "").replace(/\.\d+$/, ""); }

const calendarSubscriptionAudience = `(
  (calendar.scope='personal' AND calendar.owner_user_id=membership.user_id)
  OR (calendar.scope='group' AND EXISTS (
    SELECT 1 FROM church_groups church_group WHERE church_group.id=calendar.group_id
      AND church_group.department_id=calendar.department_id AND church_group.status='active'
  ) AND (
    membership.role='site_admin' OR membership.permissions && ARRAY['events_manage','groups_manage']
    OR COALESCE(membership.module_permissions->'church-calendar','[]'::jsonb) @> '["manage"]'::jsonb
    OR EXISTS (SELECT 1 FROM group_members member WHERE member.group_id=calendar.group_id
                  AND member.contact_id=membership.contact_id AND member.status='active')
  ))
)`;

async function notifyAppointmentCreator(client: PoolClient, departmentId: string, appointmentId: string, actorId: string) {
  if (!isServerModuleEnabled("notifications")) return false;
  const storage = await client.query<{ installed: boolean }>("SELECT to_regclass('public.module_notifications') IS NOT NULL AS installed");
  if (!storage.rows[0]?.installed) return false;
  const result = await client.query(
    `INSERT INTO module_notifications (id,department_id,recipient_user_id,sender_user_id,kind,title,body,in_app_enabled,email_enabled)
     SELECT $4,calendar.department_id,account.id,$3,'calendar_appointment_updated','Calendar appointment updated',
            'An appointment you created changed. Open Calendar to see current appointments.',true,true
       FROM church_calendar_appointments appointment
       JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
       JOIN department_memberships membership ON membership.department_id=calendar.department_id AND membership.user_id=appointment.created_by
       JOIN app_users account ON account.id=membership.user_id AND account.is_enabled AND NOT account.is_service_user
      WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL
        AND calendar.archived_at IS NULL AND account.id<>$3
        AND (calendar.scope='community' OR ${calendarSubscriptionAudience})`,
    [appointmentId, departmentId, actorId, randomUUID()],
  );
  return Boolean(result.rowCount);
}

async function registrationFormTemplatesInstalled(db: Pick<PoolClient, "query">) {
  const result = await db.query<{ installed: boolean }>(
    `SELECT count(*)=3 AS installed FROM pg_attribute
         WHERE attrelid=to_regclass('public.group_signup_forms') AND NOT attisdropped
           AND attname IN ('active_seat_limit','waitlist_limit','counted_roles')`,
  );
  return Boolean(result.rows[0]?.installed);
}

async function lockRegistrationTemplate(client: PoolClient, departmentId: string, templateGroupId: string) {
  if (!await registrationFormTemplatesInstalled(client)) {
    return { status: 409, error: "Registration form templates are unavailable at this site." } as const;
  }
  const template = await client.query(
    `SELECT form.group_id FROM church_groups groups
       JOIN group_signup_forms form ON form.group_id=groups.id AND form.department_id=groups.department_id
      WHERE groups.id=$1 AND groups.department_id=$2 AND groups.status IN ('active','draft')
        AND groups.source_system IS NULL FOR SHARE OF groups,form`,
    [templateGroupId, departmentId],
  );
  return template.rowCount ? null : { status: 404, error: "Signup form template not found in this location." } as const;
}

async function copyRegistrationForm(client: PoolClient, departmentId: string, templateGroupId: string, groupIds: string[]) {
  // Copy form settings only. Draft groups start empty with public signup disabled.
  await client.query(
    `INSERT INTO group_signup_forms(group_id,department_id,revision,questions,default_role,heading,active_seat_limit,waitlist_limit,counted_roles)
     SELECT generated.group_id,template.department_id,gen_random_uuid(),template.questions,template.default_role,template.heading,
            template.active_seat_limit,template.waitlist_limit,template.counted_roles
       FROM group_signup_forms template CROSS JOIN unnest($3::uuid[]) generated(group_id)
      WHERE template.group_id=$1 AND template.department_id=$2`,
    [templateGroupId, departmentId, groupIds],
  );
}

async function createDraftRegistrationGroup(client: PoolClient, departmentId: string, appointmentId: string, title: string, start: string) {
  const groupId = randomUUID();
  const date = start.slice(0, 10);
  const time = start.slice(11, 19).replace(/:/g, "");
  const name = `Reg ${date}-${time} ${title.slice(0, 70)} ${appointmentId.slice(0, 8)}`;
  await client.query(
    `INSERT INTO church_groups(id,department_id,name,description,status,starts_on,ends_on,public_signup_enabled)
     VALUES($1,$2,$3,'Registration group for a Calendar appointment.','draft',$4,$4,false)`,
    [groupId, departmentId, name, date],
  );
  return groupId;
}

async function lockCalendarSeries(db: PoolClient, id: string, departmentId: string) {
  const { rows: [row] } = await db.query<{ starts_at: string; ends_at: string; recurrence: Recurrence | null }>(
    `SELECT to_char(starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,to_char(ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at,recurrence
       FROM church_calendar_appointments WHERE id=$1 AND department_id=$2 AND archived_at IS NULL FOR UPDATE`, [id, departmentId],
  );
  return row?.recurrence ? { ...row, recurrence: row.recurrence } : null;
}

async function updateCalendarSeriesResources(db: Pick<PoolClient, "query">, id: string, resourceIds: string[], actor: string, canManageResources: boolean) {
  await db.query(`DELETE FROM church_calendar_resource_links link
    USING resource_bookings booking, bookable_resources resource
    WHERE link.appointment_id=$1 AND link.occurrence_start IS NULL AND booking.id=link.resource_booking_id
      AND resource.id=booking.resource_id AND resource.department_id=booking.department_id
      AND NOT (link.resource_booking_id=ANY($2::uuid[]))
      AND (resource.visibility_group_id IS NULL OR booking.requested_by=$3 OR $4)`, [id, resourceIds, actor, canManageResources]);
  if (resourceIds.length) await db.query(
    `INSERT INTO church_calendar_resource_links(appointment_id,resource_booking_id,created_by)
     SELECT $1,booking_id,$3 FROM unnest($2::uuid[]) booking(booking_id) ON CONFLICT DO NOTHING`, [id, resourceIds, actor],
  );
}

async function moveCalendarOccurrenceLinks(db: PoolClient, oldId: string, newId: string, boundary: string, selectedOverrides: Record<string, unknown>,
  targetOccurrence: (value: string) => string | null,
) {
  const { rows } = await db.query<{ original: string }>(
    `SELECT DISTINCT to_char(original,'YYYY-MM-DD"T"HH24:MI:SS') AS original FROM (
       SELECT original_start AS original FROM church_calendar_appointment_exceptions WHERE appointment_id=$1 AND original_start >= $2::timestamp
       UNION ALL SELECT occurrence_start FROM church_calendar_resource_links WHERE appointment_id=$1 AND occurrence_start >= $2::timestamp
       UNION ALL SELECT original_start FROM church_calendar_reminders WHERE appointment_id=$1 AND original_start >= $2::timestamp
       UNION ALL SELECT occurrence_start FROM church_calendar_event_generations WHERE appointment_id=$1 AND occurrence_start >= $2::timestamp
     ) attached`, [oldId, boundary],
  );
  const linked = rows.flatMap(({ original }) => {
    const nextOriginal = targetOccurrence(original);
    return nextOriginal ? [{ original, nextOriginal }] : [];
  });
  if (!linked.length) return;
  const positions = `jsonb_to_recordset($3::jsonb) AS positions(original timestamp,"nextOriginal" timestamp)`;
  const bindings = [oldId, newId, JSON.stringify(linked)];
  await db.query(`UPDATE church_calendar_appointment_exceptions e SET appointment_id=$2,original_start=positions."nextOriginal",
    overrides=CASE WHEN e.original_start=$4::timestamp THEN $5::jsonb ELSE e.overrides END
    FROM ${positions} WHERE e.appointment_id=$1 AND e.original_start=positions.original`, [...bindings, boundary, JSON.stringify(selectedOverrides)]);
  await db.query(`UPDATE church_calendar_resource_links link SET appointment_id=$2,occurrence_start=positions."nextOriginal"
    FROM ${positions} WHERE link.appointment_id=$1 AND link.occurrence_start=positions.original`, bindings);
  await db.query(`UPDATE church_calendar_reminders reminder SET appointment_id=$2,original_start=positions."nextOriginal",
    next_check_at=LEAST(reminder.next_check_at,now()) FROM ${positions}
    WHERE reminder.appointment_id=$1 AND reminder.original_start=positions.original`, bindings);
  await db.query(`UPDATE church_calendar_event_generations generation SET appointment_id=$2,occurrence_start=positions."nextOriginal"
    FROM ${positions} WHERE generation.appointment_id=$1 AND generation.occurrence_start=positions.original`, bindings);
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  registerCalendarEmailSubscriptions(app, context);
  registerCalendarReplication(context);
  registerAppointmentTemplates(app, context, canManageCalendar);
  registerCalendarTagDefinitions(app, context, (request) => canManageCalendar(request, "community", null));
  registerCalendarMeetingRequests(app, context, canManageCalendar);
  registerCalendarBookingDescriptions(app, context, canManageCalendar);
  registerCalendarBookingDecisions(app, context, canManageCalendar);
  registerCalendarRemoval(app, context, canManageCalendar);
  registerCalendarAgendaPublications(app, context, (request) => canManageCalendar(request, "community", null), hashFeedToken);
  const unavailable = (reply: Parameters<typeof responseError>[0]) => responseError(reply, 503, "The calendar is unavailable.");
  const userId = (request: FastifyRequest) => request.authenticatedUser!.id;

  app.post<{ Params: { id: string } }>("/api/modules/church-calendar/calendars/:id/public-feed", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const calendar = await context.pool.query<{ scope: CalendarScope; owner_user_id: string | null }>("SELECT scope,owner_user_id FROM church_calendar_calendars WHERE id=$1 AND department_id=$2 AND archived_at IS NULL", [request.params.id, departmentId]);
    const row = calendar.rows[0];
    if (!row) return responseError(reply, 404, "Calendar not found.");
    if (row.scope !== "community") return responseError(reply, 400, "Only community calendars can have a public feed.");
    if (!canManageCalendar(request, row.scope, row.owner_user_id)) return responseError(reply, 403, "You cannot manage this calendar feed.");
    const token = randomBytes(32).toString("base64url");
    await context.pool.query(
      `INSERT INTO church_calendar_public_feeds(calendar_id,department_id,token_hash,created_by,revoked_at)
       VALUES($1,$2,$3,$4,NULL) ON CONFLICT(calendar_id) DO UPDATE SET department_id=EXCLUDED.department_id,token_hash=EXCLUDED.token_hash,created_by=EXCLUDED.created_by,created_at=now(),revoked_at=NULL`,
      [request.params.id, departmentId, hashFeedToken(token), userId(request)],
    );
    context.realtime.publish("module:church-calendar:changed", departmentId, { action: "public-feed-rotated", calendarId: request.params.id });
    return { url: `/api/public/church-calendar/feed/${token}.ics`, embedUrl: `/api/public/church-calendar/embed/${token}` };
  });

  app.delete<{ Params: { id: string } }>("/api/modules/church-calendar/calendars/:id/public-feed", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const calendar = await context.pool.query<{ scope: CalendarScope; owner_user_id: string | null }>("SELECT scope,owner_user_id FROM church_calendar_calendars WHERE id=$1 AND department_id=$2 AND archived_at IS NULL", [request.params.id, departmentId]);
    const row = calendar.rows[0];
    if (!row) return responseError(reply, 404, "Calendar not found.");
    if (row.scope !== "community" || !canManageCalendar(request, row.scope, row.owner_user_id)) return responseError(reply, 403, "You cannot manage this calendar feed.");
    await context.pool.query("UPDATE church_calendar_public_feeds SET revoked_at=now() WHERE calendar_id=$1 AND department_id=$2 AND revoked_at IS NULL", [request.params.id, departmentId]);
    context.realtime.publish("module:church-calendar:changed", departmentId, { action: "public-feed-revoked", calendarId: request.params.id });
    return { revoked: true };
  });

  app.post<{ Params: { id: string } }>("/api/modules/church-calendar/calendars/:id/subscription", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const token = randomBytes(32).toString("base64url");
    const result = await context.pool.query(
      `INSERT INTO church_calendar_subscriptions(calendar_id,department_id,user_id,token_hash)
       SELECT calendar.id,calendar.department_id,membership.user_id,$4
         FROM church_calendar_calendars calendar JOIN department_memberships membership
           ON membership.department_id=calendar.department_id AND membership.user_id=$3
        WHERE calendar.id=$1 AND calendar.department_id=$2 AND calendar.archived_at IS NULL AND ${calendarSubscriptionAudience}
       ON CONFLICT(calendar_id,user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash`,
      [request.params.id, departmentId, userId(request), hashFeedToken(token)],
    );
    if (!result.rowCount) return responseError(reply, 404, "This calendar is unavailable for personal subscriptions.");
    return reply.header("Cache-Control", "private, no-store").code(201).send({ url: `/api/public/church-calendar/subscription.ics?key=${token}` });
  });

  app.delete<{ Params: { id: string } }>("/api/modules/church-calendar/calendars/:id/subscription", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    await context.pool.query("DELETE FROM church_calendar_subscriptions WHERE calendar_id=$1 AND department_id=$2 AND user_id=$3", [request.params.id, departmentId, userId(request)]);
    return { revoked: true };
  });

  async function serveCalendarFeed(reply: FastifyReply, token: string, audience: "community" | "subscription" | "agenda", embed?: EmbedSettings) {
    reply.header("Cache-Control", "private, no-store").header("Referrer-Policy", "no-referrer");
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    const sourceTable = audience === "subscription" ? "church_calendar_subscriptions" : "church_calendar_public_feeds";
    const accessJoin = audience === "subscription" ? `JOIN department_memberships membership
      ON membership.department_id=feed.department_id AND membership.user_id=feed.user_id` : "";
    const accessPredicate = audience === "subscription" ? calendarSubscriptionAudience : "feed.revoked_at IS NULL AND calendar.scope='community'";
    const tokenHash = hashFeedToken(token);
    const source = audience === "agenda" ? await loadPublicAgenda(context.pool, tokenHash) : (await context.pool.query<{ department_id: string; calendar_ids: string[]; calendar_name: string; calendar_scope: CalendarScope; time_zone: string; local_today: string }>(
      `SELECT feed.department_id,ARRAY[feed.calendar_id] AS calendar_ids,calendar.name AS calendar_name,calendar.scope AS calendar_scope,
              COALESCE(zone.name,'UTC') AS time_zone,to_char(now() AT TIME ZONE COALESCE(zone.name,'UTC'),'YYYY-MM-DD') AS local_today
         FROM ${sourceTable} feed
         JOIN departments department ON department.id=feed.department_id
         JOIN church_calendar_calendars calendar ON calendar.id=feed.calendar_id AND calendar.department_id=feed.department_id
         LEFT JOIN pg_timezone_names zone ON zone.name=department.time_zone
         ${accessJoin}
        WHERE feed.token_hash=$1 AND calendar.archived_at IS NULL AND ${accessPredicate}`, [tokenHash])).rows[0];
    if (!source) return responseError(reply, 404, "Calendar feed not found.");
    const from = source.local_today;
    const toDate = wallDate(`${from}T00:00:00`);
    toDate.setUTCDate(toDate.getUTCDate() + (embed ? (embed.days ?? 60) - 1 : 366));
    const to = localDateTime(toDate).slice(0, 10);
    // An authored clock time can cross the public calendar's local date boundary.
    const fromDay = embed ? localDateTime(addDays(wallDate(`${from}T00:00`), -2)).slice(0, 10) : from;
    const throughDay = embed ? localDateTime(addDays(wallDate(`${to}T00:00`), 2)).slice(0, 10) : to;
    const fromTimestamp = `${fromDay}T00:00:00`;
    const throughTimestamp = `${throughDay}T23:59:59`;
    const alteredStart = `left(exception.overrides->>'startsAt',10)
      BETWEEN to_char($3::timestamp,'YYYY-MM-DD') AND to_char($4::timestamp,'YYYY-MM-DD')`;
    const events = await context.pool.query<AppointmentRow>(
      `SELECT appointment.id,appointment.calendar_id,appointment.title,appointment.subtitle,appointment.description,
              to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,to_char(appointment.ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at,
              appointment.all_day,appointment.place,appointment.url,appointment.internal_only,appointment.tags,appointment.recurrence,appointment.time_zone,
              appointment.linked_event_id,appointment.created_by,calendar.scope AS calendar_scope,calendar.name AS calendar_name,
              calendar.owner_user_id,calendar.group_id
         FROM church_calendar_appointments appointment JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
        WHERE appointment.department_id=$1 AND appointment.calendar_id=ANY($2::uuid[]) AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL
          AND calendar.scope=$5 AND appointment.internal_only=false
          ${audience === "agenda" ? `AND EXISTS (SELECT 1 FROM church_calendar_agenda_publications publication
            JOIN church_calendar_agenda_calendars membership ON membership.department_id=publication.department_id AND membership.publication_id=publication.id
            JOIN church_calendar_public_feeds feed ON feed.department_id=membership.department_id AND feed.calendar_id=membership.calendar_id AND feed.revoked_at IS NULL
            WHERE publication.department_id=$1 AND publication.token_hash=$6 AND publication.revoked_at IS NULL AND membership.calendar_id=appointment.calendar_id)` : ""}
          AND ((appointment.starts_at <= $4::timestamp AND ((appointment.recurrence IS NULL AND appointment.ends_at >= $3::timestamp)
            OR (appointment.recurrence IS NOT NULL AND COALESCE(appointment.recurrence->>'endsOn','9999-12-31')::date >= $3::date)))
            ${embed ? `OR EXISTS (SELECT 1 FROM church_calendar_appointment_exceptions exception
              WHERE exception.appointment_id=appointment.id AND NOT exception.cancelled AND ${alteredStart})
               OR EXISTS (SELECT 1 FROM church_calendar_extra_dates extra WHERE extra.appointment_id=appointment.id AND extra.starts_at BETWEEN $3::timestamp AND $4::timestamp)` : ""})
        ORDER BY appointment.starts_at,appointment.title,appointment.id LIMIT 2000`, [source.department_id, source.calendar_ids, fromTimestamp, throughTimestamp, source.calendar_scope, ...(audience === "agenda" ? [tokenHash] : [])]);
    const ids = events.rows.map((item) => item.id);
    const exceptionRows = ids.length ? await context.pool.query<{ appointment_id: string; original_start: string; cancelled: boolean; overrides: Record<string, unknown> }>(
      `SELECT appointment_id,to_char(original_start,'YYYY-MM-DD"T"HH24:MI:SS') AS original_start,cancelled,overrides FROM church_calendar_appointment_exceptions WHERE appointment_id=ANY($1::uuid[])`, [ids]) : { rows: [] };
    const extraRows = ids.length ? await context.pool.query<{ appointment_id: string; starts_at: string; ends_at: string }>(
      `SELECT extra.appointment_id,to_char(extra.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
              to_char(extra.ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at
         FROM church_calendar_extra_dates extra WHERE extra.appointment_id=ANY($1::uuid[])
           AND (extra.starts_at BETWEEN $2::timestamp AND $3::timestamp
             ${embed ? `OR EXISTS (SELECT 1 FROM church_calendar_appointment_exceptions exception
               WHERE exception.appointment_id=extra.appointment_id AND exception.original_start=extra.starts_at AND NOT exception.cancelled
                 AND left(exception.overrides->>'startsAt',10) BETWEEN to_char($2::timestamp,'YYYY-MM-DD') AND to_char($3::timestamp,'YYYY-MM-DD'))` : ""})`,
      [ids, fromTimestamp, throughTimestamp]) : { rows: [] };
    const exceptions = new Map(exceptionRows.rows.map((item) => [`${item.appointment_id}:${item.original_start.replace(" ", "T")}`, item]));
    const extraOccurrences = new Map<string, Map<string, string>>();
    for (const item of extraRows.rows) {
      const dates = extraOccurrences.get(item.appointment_id) ?? new Map<string, string>();
      dates.set(item.starts_at.replace(" ", "T"), item.ends_at.replace(" ", "T"));
      extraOccurrences.set(item.appointment_id, dates);
    }
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Smart-Church//Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEscape(source.calendar_name)}`];
    const stamp = icsDateTime(`${localDateTime(new Date())}Z`);
    const movedOccurrences = new Map<string, string[]>();
    if (embed) for (const exception of exceptionRows.rows) {
      const startsAt = cleanLocalDateTime(exception.overrides.startsAt);
      if (exception.cancelled || !startsAt || startsAt < fromTimestamp || startsAt > throughTimestamp) continue;
      const originals = movedOccurrences.get(exception.appointment_id) ?? [];
      originals.push(exception.original_start);
      movedOccurrences.set(exception.appointment_id, originals);
    }
    const publicAgenda: EmbedAppointment[] = [];
    const timedOccurrences: Array<{ line: number; startsAt: string; endsAt: string; timeZone: string }> = [];
    for (const row of events.rows) {
      const start = wallDate(row.starts_at);
      const duration = Math.max(0, wallDate(row.ends_at).getTime() - start.getTime());
      const additionalDates = [...(extraOccurrences.get(row.id)?.keys() ?? [])].map(wallDate);
      const moved = (movedOccurrences.get(row.id) ?? []).filter((original) => calendarOccurrenceExists(row, original)).map(wallDate);
      const starts = [...new Map([...occurrenceStarts(row, `${fromDay}T00:00`, `${throughDay}T23:59`), ...additionalDates, ...moved]
        .map((date) => [localDateTime(date), date])).values()];
      for (const occurrence of starts) {
        const original = localDateTime(occurrence);
        const exception = exceptions.get(`${row.id}:${original}`);
        if (exception?.cancelled || exception?.overrides?.internalOnly === true) continue;
        const override = exception?.overrides ?? {};
        const startsAt = cleanLocalDateTime(override.startsAt) ?? original;
        const endsAt = cleanLocalDateTime(override.endsAt) ?? extraOccurrences.get(row.id)?.get(original) ?? localDateTime(new Date(occurrence.getTime() + duration));
        const title = String(override.title ?? row.title);
        const allDay = (override.allDay ?? row.all_day) === true;
        if (embed) {
          const timed = allDay ? null : appointmentInstants(startsAt, endsAt, row.time_zone ?? source.time_zone);
          if (!allDay && !timed) continue;
          const displayStart = timed ? appointmentWallTime(Date.parse(timed.startsAtUtc), source.time_zone) : startsAt;
          const displayEnd = timed ? appointmentWallTime(Date.parse(timed.endsAtUtc), source.time_zone) : endsAt;
          const displayDate = displayStart.slice(0, 10);
          if (displayDate < from || displayDate > to) continue;
          publicAgenda.push({ originalStart: original, startsAt: displayStart, endsAt: displayEnd, allDay, title,
            subtitle: String(override.subtitle ?? row.subtitle), place: String(override.place ?? row.place),
            ...(audience === "agenda" ? { calendarName: row.calendar_name, calendarOrder: source.calendar_ids.indexOf(row.calendar_id) } : {}), id: row.id });
          continue;
        }
        const description = String(override.description ?? row.description);
        const place = String(override.place ?? row.place);
        const url = String(override.url ?? row.url);
        lines.push("BEGIN:VEVENT", `UID:${row.id}-${icsDateTime(original)}@smart-church`, `DTSTAMP:${stamp}`);
        if (allDay) {
          const startDate = startsAt.slice(0, 10);
          const endDate = endsAt.slice(0, 10);
          const endMidnight = wallDate(`${endDate}T00:00:00`);
          const nextStartDay = wallDate(`${startDate}T00:00:00`).getTime() + 86_400_000;
          const roundedEnd = endMidnight.getTime() + (wallDate(endsAt).getTime() > endMidnight.getTime() ? 86_400_000 : 0);
          const exclusiveEnd = localDateTime(new Date(Math.max(nextStartDay, roundedEnd))).slice(0, 10).replaceAll("-", "");
          lines.push(`DTSTART;VALUE=DATE:${startDate.replaceAll("-", "")}`, `DTEND;VALUE=DATE:${exclusiveEnd}`);
        } else {
          timedOccurrences.push({ line: lines.length, startsAt, endsAt, timeZone: row.time_zone ?? source.time_zone });
          lines.push("", "");
        }
        lines.push(`SUMMARY:${icsEscape(title)}`);
        if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
        if (place) lines.push(`LOCATION:${icsEscape(place)}`);
        if (/^https:\/\/[^\u0000-\u001f\u007f]+$/i.test(url)) lines.push(`URL:${url}`);
        lines.push("END:VEVENT");
      }
    }
    if (embed) {
      return reply.type("text/html; charset=utf-8")
        .header("Content-Security-Policy", calendarEmbedContentPolicy)
        .header("X-Robots-Tag", "noindex, nofollow")
        .send(renderCalendarEmbed(source.calendar_name, publicAgenda, source.time_zone, embed.entries ?? 20));
    }
    // Expand wall times using each appointment's time zone before exporting UTC instants.
    // Batch conversions to keep query size bounded even for large feeds.
    for (let offset = 0; offset < timedOccurrences.length; offset += 2000) {
      const batch = timedOccurrences.slice(offset, offset + 2000);
      const { rows } = await context.pool.query<{ line: number; starts_at: string; ends_at: string }>(
        `SELECT line,
                to_char(start_instant AT TIME ZONE 'UTC','YYYYMMDD"T"HH24MISS"Z"') AS starts_at,
                to_char((CASE WHEN local_end > local_start AND (end_instant <= start_instant OR start_instant AT TIME ZONE time_zone <> local_start)
                              THEN start_instant + (local_end - local_start)
                              ELSE end_instant END) AT TIME ZONE 'UTC','YYYYMMDD"T"HH24MISS"Z"') AS ends_at
           FROM (
             SELECT line,local_start,local_end,time_zone,
                    local_start AT TIME ZONE time_zone AS start_instant,
                    local_end AT TIME ZONE time_zone AS end_instant
               FROM unnest($1::int[],$2::timestamp[],$3::timestamp[],$4::text[]) occurrence(line,local_start,local_end,time_zone)
           ) converted`,
        [batch.map((item) => item.line), batch.map((item) => item.startsAt), batch.map((item) => item.endsAt), batch.map((item) => item.timeZone)],
      );
      for (const row of rows) {
        lines[row.line] = `DTSTART:${row.starts_at}`;
        lines[row.line + 1] = `DTEND:${row.ends_at}`;
      }
    }
    lines.push("END:VCALENDAR");
    const filename = encodeURIComponent(`${source.calendar_name}.ics`).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`);
    return reply.type("text/calendar; charset=utf-8")
      .header("Content-Disposition", `inline; filename="calendar.ics"; filename*=UTF-8''${filename}`)
      .send(lines.map(foldIcsLine).join("\r\n") + "\r\n");
  }

  app.get<{ Params: { token: string } }>("/api/public/church-calendar/feed/:token.ics", { schema: {
    params: { type: "object", additionalProperties: false, required: ["token"], properties: { token: { type: "string", minLength: 40, maxLength: 80, pattern: "^[A-Za-z0-9_-]+$" } } },
  } }, (request, reply) => serveCalendarFeed(reply, request.params.token, "community"));

  const publicAgendaSchema = {
    params: { type: "object", additionalProperties: false, required: ["token"], properties: { token: { type: "string", minLength: 40, maxLength: 80, pattern: "^[A-Za-z0-9_-]+$" } } },
    querystring: { type: "object", additionalProperties: false, properties: {
      days: { type: "integer", minimum: 1, maximum: 120 }, entries: { type: "integer", minimum: 1, maximum: 50 },
    } },
  } as const;
  app.get<{ Params: { token: string }; Querystring: EmbedSettings }>("/api/public/church-calendar/embed/:token", { schema: publicAgendaSchema },
    (request, reply) => serveCalendarFeed(reply, request.params.token, "community", request.query));
  app.get<{ Params: { token: string }; Querystring: EmbedSettings }>("/api/public/church-calendar/agenda/:token", { schema: publicAgendaSchema },
    (request, reply) => serveCalendarFeed(reply, request.params.token, "agenda", request.query));

  app.get<{ Querystring: { key: string } }>("/api/public/church-calendar/subscription.ics", { schema: {
    querystring: { type: "object", additionalProperties: false, required: ["key"], properties: { key: { type: "string", minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]+$" } } },
  } }, (request, reply) => serveCalendarFeed(reply, request.query.key, "subscription"));

  app.get("/api/modules/church-calendar/choices", async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const canSeeAllGroups = hasGroupVisibility(request);
    const groups = await context.pool.query(
      `SELECT church_group.id,church_group.name FROM church_groups church_group
        WHERE church_group.department_id=$1 AND church_group.status='active' AND ($3 OR EXISTS (SELECT 1 FROM department_memberships membership JOIN group_members member ON member.contact_id=membership.contact_id WHERE membership.user_id=$2 AND membership.department_id=$1 AND member.group_id=church_group.id))
        ORDER BY church_group.name LIMIT 500`, [departmentId, userId(request), canSeeAllGroups]);
    const signupGroups = await context.pool.query(
      `SELECT church_group.id,church_group.name,church_group.public_signup_token AS token FROM church_groups church_group
        WHERE church_group.department_id=$1 AND church_group.status='active' AND church_group.public_signup_enabled=true AND church_group.public_signup_token IS NOT NULL AND church_group.source_system IS NULL
        ORDER BY church_group.name LIMIT 500`, [departmentId]);
    const events = await context.pool.query<{ id: string; title: string; event_date: string }>(
      "SELECT id,title,event_date::text FROM service_events WHERE department_id=$1 ORDER BY event_date DESC,title LIMIT 250", [departmentId]);
    const canSeeAllBookings = isResourceBookingManager(request, isServerModuleEnabled("resource-scheduler"));
    const bookings = await context.pool.query<{ id: string; purpose: string; starts_at: string }>(
      `SELECT id,purpose,to_char(starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at FROM resource_bookings WHERE department_id=$1 AND status='approved' AND starts_at >= now()-interval '90 days' AND ($3 OR requested_by=$2) ORDER BY starts_at LIMIT 250`, [departmentId, userId(request), canSeeAllBookings]);
    const templatesInstalled = await context.pool.query<{ present: boolean }>("SELECT to_regclass('public.service_plan_templates') IS NOT NULL AS present");
    const canManageEvents = canManageServiceEvents(request);
    const servicePlanTemplates = canManageEvents && templatesInstalled.rows[0]?.present
      ? (await context.pool.query<{ id: string; name: string; positions: ServicePlanTemplate["positions"] }>("SELECT id,name,positions FROM service_plan_templates WHERE department_id=$1 AND active=true ORDER BY lower(name),id LIMIT 250", [departmentId])).rows
      : [];
    const canSelectPeople = canSeePrivatePeople(request);
    const canManageGroups = request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("groups_manage");
    const registrationFormTemplates = canManageGroups && await registrationFormTemplatesInstalled(context.pool)
      ? (await context.pool.query<{ id: string; name: string }>(
        `SELECT groups.id,groups.name FROM church_groups groups
             JOIN group_signup_forms form ON form.group_id=groups.id AND form.department_id=groups.department_id
            WHERE groups.department_id=$1 AND groups.status IN ('active','draft') AND groups.source_system IS NULL
            ORDER BY lower(groups.name),groups.id LIMIT 500`, [departmentId],
      )).rows : [];
    return { registrationFormTemplates, groups: groups.rows, signupGroups: signupGroups.rows, events: events.rows, resourceBookings: bookings.rows, servicePlanTemplates, canSelectPeople };
  });

  app.get<{ Querystring: { q?: string; staffing?: boolean } }>("/api/modules/church-calendar/people", { schema: {
    querystring: { type: "object", additionalProperties: false, required: ["q"], properties: { q: { type: "string", minLength: 2, maxLength: 80 }, staffing: { type: "boolean" } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const canSelectPeople = canSeePrivatePeople(request);
    if (!canSelectPeople) return responseError(reply, 403, "Private People access is required to select an appointment contact.");
    const query = (request.query.q ?? "").trim().replace(/[\\%_]/g, "").slice(0, 80);
    if (query.length < 2) return [];
    if (request.query.staffing) {
      const canManageEvents = canManageServiceEvents(request);
      if (!canManageEvents) return responseError(reply, 403, "Event management access is required to search staffing qualifications.");
      return (await context.pool.query<{ id: string; name: string; qualificationIds: string[] }>(
        `SELECT person.id,concat_ws(' ',person.first_name,person.last_name) AS name,
                COALESCE(array_agg(DISTINCT qualification.id::text) FILTER (WHERE qualification.id IS NOT NULL),'{}'::text[]) AS "qualificationIds"
           FROM contacts person
           LEFT JOIN contact_service_qualifications assignment ON assignment.department_id=person.department_id AND assignment.contact_id=person.id AND person.status='member'
           LEFT JOIN service_volunteer_qualifications qualification ON qualification.id=assignment.qualification_id AND qualification.department_id=person.department_id AND qualification.active=true
          WHERE person.department_id=$1 AND person.archived_at IS NULL
            AND (person.first_name ILIKE $2 OR person.last_name ILIKE $2 OR concat_ws(' ',person.first_name,person.last_name) ILIKE $2)
          GROUP BY person.id ORDER BY lower(person.last_name),lower(person.first_name),person.id LIMIT 50`,
        [departmentId, `%${query}%`],
      )).rows;
    }
    return (await context.pool.query<{ id: string; name: string }>(
      `SELECT id,concat_ws(' ',first_name,last_name) AS name FROM contacts
        WHERE department_id=$1 AND (first_name ILIKE $2 OR last_name ILIKE $2 OR concat_ws(' ',first_name,last_name) ILIKE $2)
        ORDER BY lower(last_name),lower(first_name),id LIMIT 50`, [departmentId, `%${query}%`],
    )).rows;
  });

  const calendarGroupContributors = `FROM church_calendar_calendars calendar
    JOIN church_groups church_group ON church_group.id=calendar.group_id AND church_group.department_id=calendar.department_id
    JOIN department_memberships membership ON membership.department_id=calendar.department_id
    JOIN group_members member ON member.group_id=church_group.id AND member.contact_id=membership.contact_id
    WHERE calendar.id=$1 AND calendar.department_id=$2 AND membership.user_id=$3
      AND calendar.scope='group' AND calendar.archived_at IS NULL AND calendar.allow_member_appointments
      AND church_group.status='active' AND member.status='active'`;

  const calendarSortOrder = { type: "integer", minimum: 0, maximum: 2_147_483_647 } as const;

  app.get("/api/modules/church-calendar/calendars", async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await context.pool.query<{ scope: CalendarScope; ownerUserId: string | null; memberCanCreate: boolean; defaultServicePlanTemplateId: string | null }>(
      `SELECT calendar.id,calendar.name,calendar.scope,calendar.group_id AS "groupId",calendar.owner_user_id AS "ownerUserId",calendar.color,calendar.sort_order AS "sortOrder",
              calendar.allow_member_appointments AS "allowMemberAppointments",
              calendar.default_service_plan_template_id AS "defaultServicePlanTemplateId",
              (calendar.scope='group' AND calendar.allow_member_appointments AND church_group.status='active' AND EXISTS (
                SELECT 1 FROM group_members member WHERE member.group_id=calendar.group_id AND member.contact_id=membership.contact_id AND member.status='active'
              )) AS "memberCanCreate",
              EXISTS(SELECT 1 FROM church_calendar_public_feeds feed WHERE feed.calendar_id=calendar.id AND feed.department_id=calendar.department_id AND feed.revoked_at IS NULL) AS "hasPublicFeed",
              EXISTS(SELECT 1 FROM church_calendar_subscriptions subscription WHERE subscription.calendar_id=calendar.id AND subscription.user_id=$2) AS "hasSubscription",
              (membership.user_id IS NOT NULL AND ${calendarSubscriptionAudience}) AS "canSubscribe",
              church_group.name AS "groupName",(calendar.owner_user_id=$2) AS "isOwner"
         FROM church_calendar_calendars calendar
         LEFT JOIN church_groups church_group ON church_group.id=calendar.group_id AND church_group.department_id=calendar.department_id
         LEFT JOIN department_memberships membership ON membership.department_id=calendar.department_id AND membership.user_id=$2
        WHERE calendar.department_id=$1 AND calendar.archived_at IS NULL
          AND (calendar.scope='community' OR calendar.owner_user_id=$2 OR (calendar.scope='group' AND ($3 OR EXISTS (
            SELECT 1 FROM department_memberships membership JOIN group_members member ON member.contact_id=membership.contact_id
             WHERE membership.user_id=$2 AND membership.department_id=$1 AND member.group_id=calendar.group_id AND member.status='active'))))
        ORDER BY CASE calendar.scope WHEN 'community' THEN 0 WHEN 'group' THEN 1 ELSE 2 END,calendar.sort_order,calendar.name,calendar.id`,
      [departmentId, userId(request), hasGroupVisibility(request)],
    );
    return result.rows.map(({ memberCanCreate, defaultServicePlanTemplateId, ...calendar }) => {
      const canManage = canManageCalendar(request, calendar.scope, calendar.ownerUserId);
      return {
        ...calendar, canManage, canCreateAppointment: canManage || memberCanCreate === true,
        ...(calendar.scope !== "personal" && canManage && canManageServiceEvents(request) ? { defaultServicePlanTemplateId } : {}),
      };
    });
  });

  app.post<{ Body: { name: string; scope: CalendarScope; groupId?: string; color?: string; sortOrder?: number; allowMemberAppointments?: boolean } }>("/api/modules/church-calendar/calendars", { schema: {
    body: { type: "object", additionalProperties: false, required: ["name", "scope"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, scope: { type: "string", enum: ["community", "group", "personal"] }, groupId: { type: "string", format: "uuid" }, color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }, sortOrder: calendarSortOrder, allowMemberAppointments: { type: "boolean" } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const scope = request.body.scope;
    if (scope !== "group" && request.body.allowMemberAppointments === true) return responseError(reply, 400, "Only group calendars can allow member appointments.");
    const name = request.body.name.trim();
    if (!name) return responseError(reply, 400, "Enter a calendar name.");
    const ownerId = scope === "personal" ? userId(request) : null;
    if (scope !== "personal" && !canManageCalendar(request, scope, ownerId)) return responseError(reply, 403, "You do not have permission to create a shared calendar.");
    if (scope === "group") {
      if (!request.body.groupId) return responseError(reply, 400, "Choose a group for this calendar.");
      const group = await context.pool.query("SELECT id FROM church_groups WHERE id=$1 AND department_id=$2", [request.body.groupId, departmentId]);
      if (!group.rowCount) return responseError(reply, 404, "The selected group was not found.");
    }
    const id = randomUUID();
    const client = await context.pool.connect();
    let created: unknown;
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return responseError(reply, 409, "This location is read-only on this installation.");
      }
      const result = await client.query(
        `INSERT INTO church_calendar_calendars(id,department_id,name,scope,group_id,owner_user_id,color,created_by,sort_order,allow_member_appointments)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,name,scope,group_id AS "groupId",owner_user_id AS "ownerUserId",color,sort_order AS "sortOrder",allow_member_appointments AS "allowMemberAppointments"`,
        [id, departmentId, name, scope, scope === "group" ? request.body.groupId : null, ownerId, request.body.color ?? "#3b82f6", userId(request), request.body.sortOrder ?? 0, scope === "group" && request.body.allowMemberAppointments === true],
      );
      created = result.rows[0];
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    context.realtime.publish("module:church-calendar:changed", departmentId, { action: "calendar-created", calendarId: id });
    return reply.code(201).send(created);
  });

  app.patch<{ Params: { id: string }; Body: { name: string; color: string; sortOrder?: number; allowMemberAppointments?: boolean; defaultServicePlanTemplateId?: string | null } }>("/api/modules/church-calendar/calendars/:id", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["name", "color"], properties: {
        name: { type: "string", minLength: 1, maxLength: 120 },
        color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        sortOrder: calendarSortOrder,
        allowMemberAppointments: { type: "boolean" },
        defaultServicePlanTemplateId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
      } },
    },
  }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const name = request.body.name.trim();
    if (!name) return responseError(reply, 400, "Enter a calendar name.");

    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return responseError(reply, 409, "This location is read-only on this installation.");
      }
      const { id } = request.params;
      const { rows: [calendar] } = await client.query<{ scope: CalendarScope; owner_user_id: string | null }>(
        "SELECT scope,owner_user_id FROM church_calendar_calendars WHERE id=$1 AND department_id=$2 AND archived_at IS NULL FOR UPDATE",
        [id, departmentId],
      );
      if (!calendar || !canManageCalendar(request, calendar.scope, calendar.owner_user_id)) {
        await client.query("ROLLBACK");
        return responseError(reply, 404, "Editable calendar not found.");
      }
      if (calendar.scope !== "group" && request.body.allowMemberAppointments === true) {
        await client.query("ROLLBACK");
        return responseError(reply, 400, "Only group calendars can allow member appointments.");
      }
      const defaultTemplateId = request.body.defaultServicePlanTemplateId;
      if (defaultTemplateId !== undefined) {
        if (calendar.scope === "personal" || !canManageServiceEvents(request)) {
          await client.query("ROLLBACK");
          return responseError(reply, 403, "Event management access is required to configure a shared calendar's service-plan template.");
        }
        if (defaultTemplateId) {
          const { rows: [availability] } = await client.query<{ present: boolean }>("SELECT to_regclass('public.service_plan_templates') IS NOT NULL AS present");
          if (!availability?.present) {
            await client.query("ROLLBACK");
            return responseError(reply, 409, "Service-plan templates are unavailable.");
          }
          const template = await client.query("SELECT id FROM service_plan_templates WHERE id=$1 AND department_id=$2 AND active=true FOR SHARE", [defaultTemplateId, departmentId]);
          if (!template.rowCount) {
            await client.query("ROLLBACK");
            return responseError(reply, 400, "Choose an active service-plan template from this location.");
          }
        }
      }
      const { rows: [updated] } = await client.query<{ sortOrder: number; allowMemberAppointments: boolean }>(
        `UPDATE church_calendar_calendars SET name=$3,color=$4,sort_order=COALESCE($5::integer,sort_order),
          allow_member_appointments=COALESCE($6::boolean,allow_member_appointments),
          default_service_plan_template_id=CASE WHEN $7 THEN $8::uuid ELSE default_service_plan_template_id END,updated_at=now()
          WHERE id=$1 AND department_id=$2 RETURNING sort_order AS "sortOrder",allow_member_appointments AS "allowMemberAppointments"`,
        [id, departmentId, name, request.body.color, request.body.sortOrder ?? null, request.body.allowMemberAppointments ?? null, defaultTemplateId !== undefined, defaultTemplateId ?? null],
      );
      await client.query("COMMIT");
      context.realtime.publish("module:church-calendar:changed", departmentId, { action: "calendar-updated", calendarId: id });
      return { id, name, color: request.body.color, ...updated, ...(defaultTemplateId !== undefined ? { defaultServicePlanTemplateId: defaultTemplateId } : {}) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  const reminderParams = { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
  const reminderOccurrenceSchema = { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$" } as const;
  app.route<{ Params: { id: string; originalStart: string } }>({
    method: ["GET", "POST"],
    url: "/api/modules/church-calendar/appointments/:id/group-meetings/:originalStart",
    schema: { params: {
      type: "object", additionalProperties: false, required: ["id", "originalStart"], properties: {
        id: { type: "string", format: "uuid" }, originalStart: reminderOccurrenceSchema,
      },
    } },
    async handler(request, reply) {
      if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
      const create = request.method === "POST";
      if (create && !context.validateMutation(request, reply)) return reply;
      const departmentId = await context.resolveDepartmentId(request, reply);
      if (!departmentId) return reply;
      if (request.activeDepartmentRole !== "site_admin" && !(request.activeDepartmentPermissions ?? []).includes("groups_manage")) {
        return responseError(reply, 403, "Managing group attendance requires Groups management access.");
      }
      const original = cleanLocalDateTime(request.params.originalStart);
      if (!original) return responseError(reply, 400, "Choose a valid saved occurrence.");

      const client = await context.pool.connect();
      try {
        await client.query("BEGIN");
        const source = await client.query<{
          group_id: string; source_system: string | null; title: string; starts_at: string; recurrence: Recurrence | null;
        }>(
          `SELECT church_group.id AS group_id, church_group.source_system, appointment.title, appointment.recurrence,
                  to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at
             FROM church_calendar_appointments appointment
             JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
             JOIN church_groups church_group ON church_group.id=calendar.group_id AND church_group.department_id=calendar.department_id
            WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL
              AND calendar.archived_at IS NULL AND calendar.scope='group'
            ${create ? "FOR UPDATE OF appointment, church_group" : ""}`,
          [request.params.id, departmentId],
        );
        const row = source.rows[0];
        if (!row) { await client.query("ROLLBACK"); return responseError(reply, 404, "Group appointment not found."); }
        if (row.source_system === "churchtools" || row.source_system === "elvanto") {
          await client.query("ROLLBACK");
          return responseError(reply, 403, "Imported group attendance is managed in the source system.");
        }
        const exception = (await client.query<{ cancelled: boolean; overrides: Record<string, unknown> }>(
          "SELECT cancelled,overrides FROM church_calendar_appointment_exceptions WHERE appointment_id=$1 AND original_start=$2::timestamp",
          [request.params.id, original],
        )).rows[0];
        const regular = calendarOccurrenceExists(row, original);
        const extra = !regular && (await client.query(
          "SELECT 1 FROM church_calendar_extra_dates WHERE appointment_id=$1 AND starts_at=$2::timestamp",
          [request.params.id, original],
        )).rowCount;
        if (exception?.cancelled || (!regular && !extra)) {
          await client.query("ROLLBACK");
          return responseError(reply, 404, "This group appointment occurrence is unavailable.");
        }

        // A one-off keeps its link when rescheduled. A series or added date uses its original wall start.
        const occurrenceKey = !row.recurrence && regular ? "single" : original;
        type LinkedMeeting = { id: string; groupId: string; date: string; title: string };
        const matching = await client.query<LinkedMeeting>(
          `SELECT id,group_id AS "groupId",meeting_date::text AS date,title FROM group_meetings
            WHERE department_id=$1 AND group_id=$2 AND calendar_appointment_id=$3 AND calendar_occurrence_key=$4`,
          [departmentId, row.group_id, request.params.id, occurrenceKey],
        );
        let meeting = matching.rows[0] ?? null;
        const created = !meeting && create;
        if (created) {
          const start = cleanLocalDateTime(exception?.overrides?.startsAt) ?? original;
          const title = typeof exception?.overrides?.title === "string" ? exception.overrides.title : row.title;
          const inserted = await client.query<LinkedMeeting>(
            `INSERT INTO group_meetings (id,department_id,group_id,meeting_date,title,calendar_appointment_id,calendar_occurrence_key)
             VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,group_id AS "groupId",meeting_date::text AS date,title`,
            [randomUUID(), departmentId, row.group_id, start.slice(0, 10), title, request.params.id, occurrenceKey],
          );
          meeting = inserted.rows[0];
          await client.query(
            `INSERT INTO group_meeting_attendance (meeting_id,contact_id)
             SELECT $1,member.contact_id FROM group_members member
             JOIN contacts contact ON contact.id=member.contact_id AND contact.department_id=$2
             WHERE member.group_id=$3 AND member.status='active'`,
            [meeting.id, departmentId, row.group_id],
          );
        }
        await client.query("COMMIT");
        if (created) context.realtime.publish("core:groups:changed", departmentId, { action: "meeting-created", groupId: row.group_id, meetingId: meeting?.id });
        return reply.code(created ? 201 : 200).send({ meeting });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  });


  app.put<{ Params: { id: string }; Body: { occurrenceStartAt: string; minutesBefore?: number; clockTime?: string; clockTimeZone?: string } }>("/api/modules/church-calendar/appointments/:id/reminder", {
    schema: { params: reminderParams, body: { type: "object", additionalProperties: false, required: ["occurrenceStartAt"],
      properties: { occurrenceStartAt: reminderOccurrenceSchema, minutesBefore: { type: "integer", enum: [5,15,30,60,1440] },
        clockTime: { type: "string", pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" }, clockTimeZone: { type: "string", maxLength: 80 } } } },
  }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (!isServerModuleEnabled("notifications")) return responseError(reply, 409, "Enable Notifications to schedule Calendar reminders.");
    const original = cleanLocalDateTime(request.body.occurrenceStartAt);
    if (!original) return responseError(reply, 400, "Choose a valid saved occurrence.");
    const { minutesBefore, clockTime, clockTimeZone } = request.body;
    const zone = canonicalTimeZone(clockTimeZone);
    let schedule: CalendarReminderSchedule;
    if (minutesBefore !== undefined && clockTime === undefined && clockTimeZone === undefined) schedule = { minutesBefore };
    else if (minutesBefore === undefined && clockTime && zone) schedule = { clockTime, clockTimeZone: zone };
    else return responseError(reply, 400, "Choose either a lead time or a local clock time and named time zone.");
    const user = userId(request);
    const reminder = await calendarReminderOccurrence(context.pool, departmentId, user, request.params.id, original);
    if (!reminder) return responseError(reply, 404, "This occurrence is unavailable.");
    const preference = await context.pool.query<{ event_reminders_enabled: boolean }>(
      "SELECT event_reminders_enabled FROM module_notification_preferences WHERE department_id=$1 AND user_id=$2", [departmentId, user],
    );
    if (preference.rows[0]?.event_reminders_enabled === false) return responseError(reply, 409, "Enable event reminders in Notifications first.");
    const window = calendarReminderWindow(reminder, schedule);
    if (!window) return responseError(reply, 400, reminder.allDay ? "Choose a valid clock time and time zone for the all-day appointment date." : "Choose a lead time for this timed appointment.");
    if (window.dueAt <= Date.now()) return responseError(reply, 400, "Choose a reminder time that has not passed.");
    await context.pool.query(
      `INSERT INTO church_calendar_reminders(appointment_id,department_id,user_id,original_start,minutes_before,clock_time,clock_time_zone,next_check_at)
       VALUES($1,$2,$3,$4::timestamp,$5,$6::time,$7,$8)
       ON CONFLICT(appointment_id,user_id,original_start) DO UPDATE SET minutes_before=EXCLUDED.minutes_before,
         clock_time=EXCLUDED.clock_time,clock_time_zone=EXCLUDED.clock_time_zone,next_check_at=EXCLUDED.next_check_at,delivered_at=NULL`,
      [request.params.id, departmentId, user, original, "minutesBefore" in schedule ? schedule.minutesBefore : null,
        "clockTime" in schedule ? schedule.clockTime : null, "clockTime" in schedule ? schedule.clockTimeZone : null, new Date(window.dueAt)],
    );
    return { ...schedule, delivered: false };
  });
  app.delete<{ Params: { id: string }; Querystring: { occurrenceStartAt: string } }>("/api/modules/church-calendar/appointments/:id/reminder", {
    schema: { params: reminderParams, querystring: { type: "object", additionalProperties: false, required: ["occurrenceStartAt"], properties: { occurrenceStartAt: reminderOccurrenceSchema } } },
  }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const original = cleanLocalDateTime(request.query.occurrenceStartAt);
    if (!original) return responseError(reply, 400, "Choose a valid saved occurrence.");
    await context.pool.query(
      "DELETE FROM church_calendar_reminders WHERE appointment_id=$1 AND department_id=$2 AND user_id=$3 AND original_start=$4::timestamp",
      [request.params.id, departmentId, userId(request), original],
    );
    return { removed: true };
  });

  app.get<{ Querystring: { from?: string; to?: string; displayTimeZone?: string; appointmentId?: string; includeOverlapping?: string; meetingRequests?: "mine" | "invitations" } }>("/api/modules/church-calendar/appointments", async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const appointmentId = request.query.appointmentId;
    if (appointmentId !== undefined && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(appointmentId)) {
      return responseError(reply, 400, "Invalid appointment identifier.");
    }
    const meetingRequests = request.query.meetingRequests;
    if (meetingRequests !== undefined && meetingRequests !== "mine" && meetingRequests !== "invitations") {
      return responseError(reply, 400, "Choose a valid meeting request filter.");
    }
    if (meetingRequests) reply.header("Cache-Control", "private, no-store");
    const preference = request.query.displayTimeZone;
    const projected = preference !== undefined;
    const overlapping = projected && request.query.includeOverlapping === "true";
    let displayZone = preference === "appointments" || preference === undefined ? null : canonicalTimeZone(preference);
    if (preference === "location") {
      const location = await context.pool.query<{ time_zone: string }>("SELECT time_zone FROM departments WHERE id=$1", [departmentId]);
      displayZone = canonicalTimeZone(location.rows[0]?.time_zone) ?? "UTC";
    } else if (projected && preference !== "appointments" && !displayZone) {
      return responseError(reply, 400, "Choose a valid display time zone.");
    }
    const when = (instant: number) => displayZone ? appointmentWallTime(instant, displayZone) : localDateTime(new Date(instant));
    const now = Date.now();
    const visibleFrom = cleanLocalDateTime(request.query.from ?? `${when(now).slice(0, 10)}T00:00`);
    const visibleTo = cleanLocalDateTime(request.query.to ?? `${when(now + 31 * 86_400_000).slice(0, 10)}T23:59:59`);
    if (!visibleFrom || !visibleTo || visibleTo < visibleFrom || ((projected || meetingRequests) && wallDate(visibleTo).getTime() - wallDate(visibleFrom).getTime() > 400 * 86_400_000)) {
      return responseError(reply, 400, "Choose a valid calendar date range of up to 400 days.");
    }
    // Authored and viewer zones can be more than one calendar date apart.
    const pad = projected ? 2 : 0;
    const from = pad ? localDateTime(addDays(startOfDay(visibleFrom), -pad)) : visibleFrom;
    const to = pad ? `${localDateTime(addDays(startOfDay(visibleTo), pad)).slice(0, 10)}T23:59:59` : visibleTo;
    const overrideWindow = `left(exception.overrides->>'startsAt',10)
      BETWEEN to_char($2::timestamp,'YYYY-MM-DD') AND to_char($3::timestamp,'YYYY-MM-DD')
      ${overlapping ? "OR (left(exception.overrides->>'endsAt',10) >= to_char($2::timestamp,'YYYY-MM-DD') AND COALESCE(left(exception.overrides->>'startsAt',10),to_char(exception.original_start,'YYYY-MM-DD')) <= to_char($3::timestamp,'YYYY-MM-DD'))" : ""}`;
    const result = await context.pool.query<AppointmentRow>(
      `SELECT appointment.id,appointment.calendar_id,appointment.title,appointment.subtitle,appointment.description,
              to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
              to_char(appointment.ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at,
              appointment.all_day,appointment.place,appointment.url,appointment.internal_only,appointment.tags,appointment.recurrence,appointment.time_zone,department.time_zone AS location_time_zone,
              appointment.linked_event_id,appointment.responsible_contact_id,appointment.created_by,calendar.scope AS calendar_scope,calendar.name AS calendar_name,
              calendar.owner_user_id,calendar.group_id,appointment.signup_group_id,
              EXISTS(SELECT 1 FROM church_calendar_appointment_images image WHERE image.appointment_id=appointment.id AND image.department_id=appointment.department_id) AS has_image
         FROM church_calendar_appointments appointment
         JOIN departments department ON department.id=appointment.department_id
         JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
        WHERE appointment.department_id=$1 AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL
          AND ($7::uuid IS NULL OR appointment.id=$7)
          AND ((appointment.starts_at <= $3::timestamp
            AND ((appointment.recurrence IS NULL AND appointment.ends_at >= $2::timestamp)
              OR (appointment.recurrence IS NOT NULL AND COALESCE(appointment.recurrence->>'endsOn','9999-12-31')::date >= $2::timestamp::date ${overlapping ? ' - (appointment.ends_at - appointment.starts_at)' : ''})))
            OR ($6::boolean AND (
              EXISTS (SELECT 1 FROM church_calendar_appointment_exceptions exception
                       WHERE exception.appointment_id=appointment.id AND NOT exception.cancelled AND (${overrideWindow}))
              OR EXISTS (SELECT 1 FROM church_calendar_extra_dates extra WHERE extra.appointment_id=appointment.id AND extra.starts_at <= $3::timestamp AND ${overlapping ? 'extra.ends_at' : 'extra.starts_at'} >= $2::timestamp)
            )))
          AND (calendar.scope='community' OR calendar.owner_user_id=$4 OR (calendar.scope='group' AND ($5 OR EXISTS (
            SELECT 1 FROM department_memberships membership JOIN group_members member ON member.contact_id=membership.contact_id
             WHERE membership.user_id=$4 AND membership.department_id=$1 AND member.group_id=calendar.group_id AND member.status='active'))))
        ORDER BY appointment.starts_at,appointment.title LIMIT 2000`,
      [departmentId, from, to, userId(request), hasGroupVisibility(request), projected, appointmentId ?? null],
    );
    const appointments = result.rows;
    if (!appointments.length) return [];
    const ids = appointments.map((row) => row.id);
    const reminders = new Map((await context.pool.query<{ appointment_id: string; original: string; minutes_before: number | null; clock_time: string | null; clock_time_zone: string | null; delivered: boolean }>(
      `SELECT appointment_id,to_char(original_start,'YYYY-MM-DD"T"HH24:MI:SS') AS original,minutes_before,
              left(clock_time::text,5) AS clock_time,clock_time_zone,delivered_at IS NOT NULL AS delivered
         FROM church_calendar_reminders WHERE department_id=$1 AND user_id=$2 AND appointment_id=ANY($3::uuid[])`, [departmentId, userId(request), ids],
    )).rows.map((reminder) => [`${reminder.appointment_id}:${reminder.original}`, {
      ...(reminder.minutes_before != null ? { minutesBefore: reminder.minutes_before } : { clockTime: reminder.clock_time, clockTimeZone: reminder.clock_time_zone }),
      delivered: reminder.delivered,
    }]));
    const exceptions = await context.pool.query<{ appointment_id: string; original_start: string; cancelled: boolean; overrides: Record<string, unknown> }>(
      `SELECT appointment_id,to_char(original_start,'YYYY-MM-DD"T"HH24:MI:SS') AS original_start,cancelled,overrides
         FROM church_calendar_appointment_exceptions WHERE appointment_id=ANY($1::uuid[])`, [ids],
    );
    const extraDates = await context.pool.query<{ appointment_id: string; starts_at: string; ends_at: string }>(
      `SELECT extra.appointment_id,to_char(extra.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,to_char(extra.ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at
         FROM church_calendar_extra_dates extra
        WHERE extra.appointment_id=ANY($1::uuid[]) AND ((extra.starts_at <= $3::timestamp AND extra.ends_at >= $2::timestamp)
          OR ($4::boolean AND EXISTS (SELECT 1 FROM church_calendar_appointment_exceptions exception
                 WHERE exception.appointment_id=extra.appointment_id AND exception.original_start=extra.starts_at
                   AND NOT exception.cancelled AND (${overrideWindow}))))`, [ids, from, to, projected],
    );
    const resourceLinks = await context.pool.query<{
      appointment_id: string; resource_booking_id: string; occurrence_start: string | null; name: string; status: string;
      lead_in_minutes: number; cleanup_minutes: number; starts_at: Date; ends_at: Date; can_manage_status: boolean;
    }>(
      `SELECT link.appointment_id,link.resource_booking_id,to_char(link.occurrence_start,'YYYY-MM-DD"T"HH24:MI:SS') AS occurrence_start,
              resource.name,booking.status,
              COALESCE((to_jsonb(booking)->>'lead_in_minutes')::int,0) AS lead_in_minutes,
              COALESCE((to_jsonb(booking)->>'cleanup_minutes')::int,0) AS cleanup_minutes,
              booking.starts_at,booking.ends_at,
              ($4 AND link.occurrence_start IS NOT NULL AND booking.ends_at>now() AND booking.status IN ('requested','approved')
                AND NOT COALESCE((to_jsonb(booking)->>'is_intake_request')::boolean,false)
                AND NOT EXISTS (SELECT 1 FROM church_calendar_resource_links other WHERE other.resource_booking_id=booking.id
                  AND (other.appointment_id<>link.appointment_id OR other.occurrence_start IS DISTINCT FROM link.occurrence_start))) AS can_manage_status
         FROM church_calendar_resource_links link
         JOIN resource_bookings booking ON booking.id=link.resource_booking_id AND booking.department_id=$2
         JOIN bookable_resources resource ON resource.id=booking.resource_id AND resource.department_id=$2
        WHERE link.appointment_id=ANY($1::uuid[])
          AND (booking.requested_by=$3 OR can_view_bookable_resource(resource.department_id,resource.visibility_group_id,$3,$4))
        ORDER BY resource.name,booking.starts_at,link.resource_booking_id`, [ids, departmentId, userId(request), isResourceBookingManager(request, isServerModuleEnabled("resource-scheduler"))],
    );
    const exceptionMap = new Map(exceptions.rows.map((row) => [`${row.appointment_id}:${row.original_start}`, row]));
    const movedStarts = new Map<string, string[]>();
    if (projected) for (const exception of exceptions.rows) {
      const start = cleanLocalDateTime(exception.overrides?.startsAt);
      const end = overlapping ? cleanLocalDateTime(exception.overrides?.endsAt) : null;
      if (exception.cancelled || (start ?? exception.original_start) > to
        || !((start && start >= from) || (end && end >= from))) continue;
      const list = movedStarts.get(exception.appointment_id);
      if (list) list.push(exception.original_start); else movedStarts.set(exception.appointment_id, [exception.original_start]);
    }
    const canViewResponsiblePeople = canSeePrivatePeople(request);
    const responsibleIds = [...new Set([
      ...appointments.map((row) => row.responsible_contact_id).filter((id): id is string => Boolean(id && /^[0-9a-f-]{36}$/i.test(id))),
      ...exceptions.rows.map((row) => typeof row.overrides?.responsibleContactId === "string" && /^[0-9a-f-]{36}$/i.test(row.overrides.responsibleContactId) ? row.overrides.responsibleContactId : null).filter((id): id is string => Boolean(id)),
    ])];
    const responsiblePeople = canViewResponsiblePeople && responsibleIds.length
      ? await context.pool.query<{ id: string; name: string }>("SELECT id,concat_ws(' ',first_name,last_name) AS name FROM contacts WHERE department_id=$1 AND id=ANY($2::uuid[])", [departmentId, responsibleIds])
      : { rows: [] as Array<{ id: string; name: string }> };
    const responsibleNames = new Map(responsiblePeople.rows.map((person) => [person.id, person.name]));
    const signupGroupIds = [...new Set([
      ...appointments.map((row) => row.signup_group_id).filter((id): id is string => Boolean(id)),
      ...exceptions.rows.map((row) => typeof row.overrides?.signupGroupId === "string" ? row.overrides.signupGroupId : null).filter((id): id is string => Boolean(id)),
    ])];
    const signupGroups = signupGroupIds.length ? await context.pool.query<{ id: string; name: string; public_signup_enabled: boolean; public_signup_token: string | null }>(
      "SELECT id,name,public_signup_enabled,public_signup_token FROM church_groups WHERE department_id=$1 AND id=ANY($2::uuid[])", [departmentId, signupGroupIds],
    ) : { rows: [] as Array<{ id: string; name: string; public_signup_enabled: boolean; public_signup_token: string | null }> };
    const signupGroupsById = new Map(signupGroups.rows.map((group) => [group.id, group]));
    const eventIds = [...new Set([
      ...appointments.map((row) => row.linked_event_id),
      ...exceptions.rows.filter((row) => !row.cancelled).map((row) => row.overrides?.linkedEventId),
    ].filter((id): id is string => typeof id === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)).map((id) => id.toLowerCase()))];
    const linkedEvents = new Map(eventIds.length ? (await context.pool.query<{
      id: string; cancelled: boolean; token: string | null; capacity: number | null; open: boolean; registered: number; waitlisted: number;
    }>(
      `SELECT event.id,event.cancelled_at IS NOT NULL AS cancelled,
              CASE WHEN event.registration_enabled AND event.cancelled_at IS NULL THEN event.registration_token END AS token,
              event.registration_capacity AS capacity,event.event_date>=CURRENT_DATE AS open,
              count(registration.id) FILTER (WHERE registration.status='registered')::int AS registered,
              count(registration.id) FILTER (WHERE registration.status='waitlisted')::int AS waitlisted
         FROM service_events event
         LEFT JOIN event_registrations registration ON registration.event_id=event.id AND event.registration_enabled AND event.cancelled_at IS NULL
        WHERE event.department_id=$1 AND event.id=ANY($2::uuid[])
        GROUP BY event.id`, [departmentId, eventIds],
    )).rows.map((event) => [event.id, event] as const) : []);
    const extraMap = new Map<string, Array<{ startsAt: string; endsAt: string }>>();
    for (const row of extraDates.rows) extraMap.set(row.appointment_id, [...(extraMap.get(row.appointment_id) ?? []), { startsAt: row.starts_at.replace(" ", "T"), endsAt: row.ends_at.replace(" ", "T") }]);
    const links = new Map<string, typeof resourceLinks.rows>();
    for (const row of resourceLinks.rows) {
      const key = row.occurrence_start ? `${row.appointment_id}:${row.occurrence_start}` : row.appointment_id;
      const existing = links.get(key);
      if (existing) existing.push(row); else links.set(key, [row]);
    }
    const requestScope = meetingRequests ? await loadOccurrenceRequestScope(
      context.pool, departmentId, userId(request), appointments.filter((row) => row.calendar_scope === "group").map((row) => row.id),
      visibleFrom, visibleTo,
    ) : undefined;
    const output: Occurrence[] = [];
    for (const row of appointments) {
      const seriesTimeZone = row.time_zone ?? null;
      const timeZone = seriesTimeZone ?? canonicalTimeZone(row.location_time_zone) ?? "UTC";
      const baseStart = wallDate(row.starts_at);
      const baseEnd = wallDate(row.ends_at);
      const duration = Math.max(0, baseEnd.getTime() - baseStart.getTime());
      const firstCandidate = overlapping ? localDateTime(new Date(wallDate(from).getTime() - duration)) : from;
      const starts = occurrenceStarts(row, firstCandidate, to);
      const extraEnds = new Map((extraMap.get(row.id) ?? []).map((extra) => [extra.startsAt, extra.endsAt]));
      const originals = new Set([...starts.map(localDateTime), ...extraEnds.keys()]);
      for (const original of movedStarts.get(row.id) ?? []) {
        if (!originals.has(original) && calendarOccurrenceExists(row, original)) originals.add(original);
      }
      for (const original of originals) {
        const exception = exceptionMap.get(`${row.id}:${original}`);
        if (exception?.cancelled) continue;
        const override = exception?.overrides ?? {};
        const signupGroupId = Object.prototype.hasOwnProperty.call(override, "signupGroupId") ? override.signupGroupId as string | null : row.signup_group_id;
        const effectiveEventId = Object.prototype.hasOwnProperty.call(override, "linkedEventId") ? override.linkedEventId : row.linked_event_id;
        const linkedEvent = typeof effectiveEventId === "string" ? linkedEvents.get(effectiveEventId.toLowerCase()) : undefined;
        const internalOnly = (override.internalOnly ?? row.internal_only) === true;
        const eventRegistration = linkedEvent?.token && row.calendar_scope === "community" && !row.internal_only && !internalOnly
          ? { token: linkedEvent.token, capacity: linkedEvent.capacity, open: linkedEvent.open, registered: linkedEvent.registered, waitlisted: linkedEvent.waitlisted }
          : null;
        const rawResponsibleContactId = Object.prototype.hasOwnProperty.call(override, "responsibleContactId") ? override.responsibleContactId : row.responsible_contact_id;
        const responsibleContactId = typeof rawResponsibleContactId === "string" && /^[0-9a-f-]{36}$/i.test(rawResponsibleContactId) ? rawResponsibleContactId : null;
        const signupGroup = signupGroupId ? signupGroupsById.get(signupGroupId) : undefined;
        const startAt = cleanLocalDateTime(override.startsAt) ?? original;
        const endAt = cleanLocalDateTime(override.endsAt) ?? extraEnds.get(original) ?? localDateTime(new Date(wallDate(original).getTime() + duration));
        if (!projected && (endAt < from || startAt > to)) continue;
        const allDay = (override.allDay ?? row.all_day) === true;
        const instants = allDay ? null : appointmentInstants(startAt, endAt, timeZone);
        const viewTimeZone = displayZone ?? timeZone;
        const viewStartsAt = instants ? appointmentWallTime(Date.parse(instants.startsAtUtc), viewTimeZone) : startAt;
        const resourceWindow = allDay ? calendarBookingWindow(startAt, endAt, true, timeZone) : instants;
        const viewEndsAt = resourceWindow ? appointmentWallTime(Date.parse(resourceWindow.endsAtUtc), allDay ? timeZone : viewTimeZone) : endAt;
        const inRange = viewStartsAt <= visibleTo && (viewStartsAt >= visibleFrom || (overlapping && viewEndsAt > visibleFrom));
        if (projected && !inRange) continue;
        const requestKey = requestScope && row.calendar_scope === "group" && resourceWindow
          ? occurrenceRequestKey(row.id, original, resourceWindow.startsAtUtc, resourceWindow.endsAtUtc)
          : null;
        const myMeetingResponse = requestKey ? requestScope?.get(requestKey) : undefined;
        if (requestScope && (meetingRequests === "invitations" ? !myMeetingResponse : myMeetingResponse === null)) continue;

        const seriesBookings = links.get(row.id) ?? [];
        const resourceBookings = [...seriesBookings, ...(links.get(`${row.id}:${original}`) ?? [])].map((booking) => ({
          id: booking.resource_booking_id, name: booking.name, status: booking.status,
          leadInMinutes: booking.lead_in_minutes, cleanupMinutes: booking.cleanup_minutes,
          ...(booking.occurrence_start ? { scope: "occurrence", canManageStatus: booking.can_manage_status, timeMismatch: !resourceWindow
            || booking.starts_at.getTime() !== Date.parse(resourceWindow.startsAtUtc) || booking.ends_at.getTime() !== Date.parse(resourceWindow.endsAtUtc) } : { scope: "series" }),
        }));
        output.push({
          appointmentId: row.id, occurrenceStartAt: startAt, occurrenceEndAt: endAt, originalOccurrenceStartAt: original, seriesTimeZone, timeZone,
          ...(projected ? { viewStartsAt, viewEndsAt, viewTimeZone } : {}),
          reminder: reminders.get(`${row.id}:${original}`) ?? null,
          startsAtUtc: instants?.startsAtUtc ?? null, endsAtUtc: instants?.endsAtUtc ?? null, timeShifted: instants?.shifted ?? false, seriesStartsAt: row.starts_at, calendarId: row.calendar_id,
          calendarName: row.calendar_name, calendarScope: row.calendar_scope, groupId: row.group_id,
          title: override.title ?? row.title, subtitle: override.subtitle ?? row.subtitle, description: override.description ?? row.description,
          allDay, place: override.place ?? row.place, url: override.url ?? row.url,
          internalOnly, tags: override.tags ?? row.tags,
          recurrence: row.recurrence, linkedEventId: linkedEvent?.id ?? null, linkedEventCancelled: linkedEvent?.cancelled ?? false, eventRegistration,
          ...(myMeetingResponse ? { myMeetingResponse } : {}),
          resourceBookingIds: seriesBookings.map((booking) => booking.resource_booking_id), resourceBookings,
          resourceWindow: resourceWindow && { startsAt: resourceWindow.startsAtUtc, endsAt: resourceWindow.endsAtUtc },
          signupGroupId, signupGroupName: signupGroup?.name ?? null,
          signupToken: signupGroup?.public_signup_enabled ? signupGroup.public_signup_token : null,
          responsibleContactId: canViewResponsiblePeople && responsibleContactId && responsibleNames.has(responsibleContactId) ? responsibleContactId : null,
          responsiblePersonName: canViewResponsiblePeople && responsibleContactId ? responsibleNames.get(responsibleContactId) ?? null : null,
          imageUrl: row.has_image ? `/api/modules/church-calendar/appointments/${row.id}/image` : null,
          canManage: canManageCalendar(request, row.calendar_scope, row.owner_user_id),
        });
      }
    }
    return output.sort((left, right) => {
      if (!projected) return left.occurrenceStartAt.localeCompare(right.occurrenceStartAt);
      const leftTime = left.viewStartsAt ?? left.occurrenceStartAt;
      const rightTime = right.viewStartsAt ?? right.occurrenceStartAt;
      return leftTime.slice(0, 10).localeCompare(rightTime.slice(0, 10))
        || Number(Boolean(right.allDay)) - Number(Boolean(left.allDay))
        || (displayZone && left.startsAtUtc && right.startsAtUtc ? left.startsAtUtc.localeCompare(right.startsAtUtc) : leftTime.localeCompare(rightTime));
    }).slice(0, 2500);
  });

  app.post<{ Params: { id: string }; Body: { throughDate: string; templateGroupId?: string } }>("/api/modules/church-calendar/appointments/:id/registration-groups", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    body: { type: "object", additionalProperties: false, required: ["throughDate"], properties: { throughDate: { type: "string", format: "date" }, templateGroupId: { type: "string", format: "uuid" } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const canManageGroups = request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("groups_manage");
    if (!canManageGroups) return responseError(reply, 403, "Group management access is required to create registration groups.");
    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<AppointmentRow>(
        `SELECT appointment.id,appointment.title,to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
                appointment.ends_at::text AS ends_at,appointment.recurrence,appointment.all_day,appointment.subtitle,appointment.description,
                appointment.place,appointment.url,appointment.internal_only,appointment.tags,appointment.linked_event_id,appointment.created_by,
                appointment.signup_group_id,calendar.scope AS calendar_scope,calendar.name AS calendar_name,calendar.owner_user_id,calendar.group_id
           FROM church_calendar_appointments appointment JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
          WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL FOR UPDATE OF appointment`,
        [request.params.id, departmentId],
      );
      const row = found.rows[0];
      if (!row) { await client.query("ROLLBACK"); return responseError(reply, 404, "Appointment not found."); }
      if (!canManageCalendar(request, row.calendar_scope, row.owner_user_id)) { await client.query("ROLLBACK"); return responseError(reply, 403, "You cannot change this appointment."); }
      if (!row.recurrence) { await client.query("ROLLBACK"); return responseError(reply, 400, "Registration groups can be generated only for a recurring appointment."); }
      const templateGroupId = request.body.templateGroupId;
      if (templateGroupId) {
        const problem = await lockRegistrationTemplate(client, departmentId, templateGroupId);
        if (problem) { await client.query("ROLLBACK"); return responseError(reply, problem.status, problem.error); }
      }
      const startDate = row.starts_at.slice(0, 10);
      const throughDate = request.body.throughDate;
      const maximum = new Date(`${startDate}T00:00:00Z`); maximum.setUTCFullYear(maximum.getUTCFullYear() + 5);
      if (throughDate < startDate || throughDate > maximum.toISOString().slice(0, 10)) { await client.query("ROLLBACK"); return responseError(reply, 400, "Choose an end date from the series start through five years ahead."); }
      const recurrenceStarts = occurrenceStarts(row, `${startDate}T00:00`, `${throughDate}T23:59`, 501).map(localDateTime);
      const extraDates = await client.query<{ starts_at: string }>(
        "SELECT to_char(starts_at,'YYYY-MM-DD\"T\"HH24:MI:SS') AS starts_at FROM church_calendar_extra_dates WHERE appointment_id=$1 AND starts_at >= $2::timestamp AND starts_at < ($3::date + 1)::timestamp ORDER BY starts_at LIMIT 501",
        [row.id, `${startDate}T00:00:00`, throughDate],
      );
      const starts = [...new Set([...recurrenceStarts, ...extraDates.rows.map((extra) => extra.starts_at.replace(" ", "T"))])].sort();
      if (starts.length > 500) { await client.query("ROLLBACK"); return responseError(reply, 400, "That date range contains more than 500 occurrences. Choose an earlier end date."); }
      if (!starts.length) { await client.query("ROLLBACK"); return responseError(reply, 400, "No generated occurrences fall within that date range."); }
      const existing = await client.query<{ original_start: string; cancelled: boolean; overrides: Record<string, unknown> }>(
        `SELECT to_char(original_start,'YYYY-MM-DD"T"HH24:MI:SS') AS original_start,cancelled,overrides
           FROM church_calendar_appointment_exceptions WHERE appointment_id=$1 AND original_start >= $2::timestamp AND original_start < ($3::date + 1)::timestamp FOR UPDATE`,
        [row.id, `${startDate}T00:00:00`, throughDate],
      );
      const byStart = new Map(existing.rows.map((item) => [item.original_start.replace(" ", "T"), item]));
      const pending = starts.filter((start) => !byStart.get(start)?.cancelled && !byStart.get(start)?.overrides?.signupGroupId);
      await client.query("SELECT set_config('smart_church.actor_id',$1,true)", [userId(request)]);
      const createdGroupIds: string[] = [];
      for (const start of pending) {
        const groupId = randomUUID();
        const occurrenceDate = start.slice(0, 10);
        const occurrenceTime = start.slice(11, 19).replace(/:/g, "");
        const name = `Reg ${occurrenceDate}-${occurrenceTime} ${row.title.slice(0, 70)} ${row.id.slice(0, 8)}`.slice(0, 120);
        const description = `Registration group for “${row.title.slice(0, 150)}” on ${occurrenceDate}. Public signup is disabled until a manager enables it.`;
        try {
          await client.query("INSERT INTO church_groups(id,department_id,name,description,status,starts_on,ends_on) VALUES($1,$2,$3,$4,'draft',$5,$5)", [groupId, departmentId, name, description, occurrenceDate]);
        } catch {
          await client.query("ROLLBACK");
          return responseError(reply, 409, `A group named “${name}” already exists. Rename or remove it before generating registration groups.`);
        }
        await client.query(
          `INSERT INTO church_calendar_appointment_exceptions(appointment_id,original_start,cancelled,overrides,updated_by)
           VALUES($1,$2::timestamp,false,jsonb_build_object('signupGroupId',$3::text),$4)
           ON CONFLICT(appointment_id,original_start) DO UPDATE SET cancelled=false,overrides=church_calendar_appointment_exceptions.overrides || EXCLUDED.overrides,updated_by=EXCLUDED.updated_by,updated_at=now()`,
          [row.id, start, groupId, userId(request)],
        );
        createdGroupIds.push(groupId);
      }
      if (templateGroupId && createdGroupIds.length) await copyRegistrationForm(client, departmentId, templateGroupId, createdGroupIds);
      const created = createdGroupIds.length;
      await client.query("COMMIT");
      context.realtime.publish("module:church-calendar:changed", departmentId, { action: "registration-groups-generated", appointmentId: row.id, created });
      return { created, alreadyLinked: starts.filter((start) => Boolean(byStart.get(start)?.overrides?.signupGroupId)).length, skippedCancelled: starts.filter((start) => byStart.get(start)?.cancelled).length, throughDate };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.post<{ Params: { id: string }; Body: { throughDate: string; templateId: string; kind: "service" | "meeting" | "community" | "other"; preview?: boolean; registrationEnabled?: boolean; registrationCapacity?: number; staffAssignments?: Array<{ positionIndex: number; positionName: string; contactId: string }> } }>("/api/modules/church-calendar/appointments/:id/service-events", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    body: { type: "object", additionalProperties: false, required: ["throughDate", "templateId", "kind"], properties: { throughDate: { type: "string", format: "date" }, templateId: { type: "string", format: "uuid" }, kind: { type: "string", enum: ["service", "meeting", "community", "other"] }, preview: { type: "boolean" }, registrationEnabled: { type: "boolean" }, registrationCapacity: { type: "integer", minimum: 1, maximum: 100000 }, staffAssignments: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false, required: ["positionIndex", "positionName", "contactId"], properties: { positionIndex: { type: "integer", minimum: 0, maximum: 39 }, positionName: { type: "string", minLength: 1, maxLength: 80 }, contactId: { type: "string", format: "uuid" } } } } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const canManageEvents = canManageServiceEvents(request);
    if (!canManageEvents) return responseError(reply, 403, "Event management access is required to generate service events.");
    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<AppointmentRow>(
        `SELECT appointment.id,appointment.title,to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
                to_char(appointment.ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at,appointment.recurrence,appointment.all_day,
                appointment.time_zone,department.time_zone AS location_time_zone,
                appointment.subtitle,appointment.description,appointment.place,appointment.url,appointment.internal_only,appointment.tags,
                appointment.linked_event_id,appointment.created_by,calendar.scope AS calendar_scope,calendar.name AS calendar_name,
                calendar.owner_user_id,calendar.group_id
           FROM church_calendar_appointments appointment JOIN departments department ON department.id=appointment.department_id
           JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
          WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL FOR UPDATE OF appointment`,
        [request.params.id, departmentId],
      );
      const row = found.rows[0];
      if (!row) { await client.query("ROLLBACK"); return responseError(reply, 404, "Appointment not found."); }
      if (!canManageCalendar(request, row.calendar_scope, row.owner_user_id)) { await client.query("ROLLBACK"); return responseError(reply, 403, "You cannot change this appointment."); }
      if (!row.recurrence) { await client.query("ROLLBACK"); return responseError(reply, 400, "Service events can be generated only for a recurring appointment."); }
      const startDate = row.starts_at.slice(0, 10);
      const throughDate = request.body.throughDate;
      const maximum = new Date(`${startDate}T00:00:00Z`); maximum.setUTCFullYear(maximum.getUTCFullYear() + 5);
      if (throughDate < startDate || throughDate > maximum.toISOString().slice(0, 10)) { await client.query("ROLLBACK"); return responseError(reply, 400, "Choose an end date from the series start through five years ahead."); }
      const template = await loadCalendarEventTemplate(client, departmentId, request.body.templateId);
      if (template.error !== undefined) { await client.query("ROLLBACK"); return responseError(reply, template.status, template.error); }
      const { positions, items, qualificationIds } = template;
      const requestedAssignments = request.body.staffAssignments ?? [];
      if (requestedAssignments.length && !canSeePrivatePeople(request)) { await client.query("ROLLBACK"); return responseError(reply, 403, "Private People access is required to assign volunteers during generation."); }
      const assignmentsByIndex = new Map<number, string>();
      for (const assignment of requestedAssignments) {
        if (!Number.isInteger(assignment.positionIndex) || assignment.positionIndex < 0 || assignment.positionIndex >= positions.length
          || assignmentsByIndex.has(assignment.positionIndex)) {
          await client.query("ROLLBACK"); return responseError(reply, 400, "Choose each template role at most once for staff assignments.");
        }
        if (assignment.positionName.trim().toLocaleLowerCase() !== positions[assignment.positionIndex].name.trim().toLocaleLowerCase()) {
          await client.query("ROLLBACK"); return responseError(reply, 409, "The template roles changed after the assignment form loaded. Refresh the calendar and choose the assignments again.");
        }
        assignmentsByIndex.set(assignment.positionIndex, assignment.contactId.toLowerCase());
      }
      const assignedContactIds = [...new Set(requestedAssignments.map((assignment) => assignment.contactId.toLowerCase()))];
      if (assignedContactIds.length) {
        const contacts = await client.query("SELECT id FROM contacts WHERE department_id=$1 AND archived_at IS NULL AND id=ANY($2::uuid[]) FOR SHARE", [departmentId, assignedContactIds]);
        if (contacts.rowCount !== assignedContactIds.length) { await client.query("ROLLBACK"); return responseError(reply, 400, "Every assigned volunteer must be a People record in this location."); }
      }
      if (assignedContactIds.length && qualificationIds.length) {
        const { rows } = await client.query<{ contact_id: string; qualification_id: string }>(
          `SELECT assignment.contact_id,assignment.qualification_id
             FROM contact_service_qualifications assignment
             JOIN contacts person ON person.id=assignment.contact_id AND person.department_id=assignment.department_id
            WHERE assignment.department_id=$1 AND assignment.contact_id=ANY($2::uuid[]) AND assignment.qualification_id=ANY($3::uuid[])
              AND person.status='member' AND person.archived_at IS NULL FOR SHARE OF assignment`,
          [departmentId, assignedContactIds, qualificationIds],
        );
        const qualified = new Set(rows.map((row) => `${row.contact_id}:${row.qualification_id}`));
        for (const [index, contactId] of assignmentsByIndex) {
          const role = positions[index];
          if (role.qualificationIds?.some((id) => !qualified.has(`${contactId.toLowerCase()}:${id}`))) {
            await client.query("ROLLBACK"); return responseError(reply, 409, `The assigned volunteer does not have every required qualification for ${role.name}.`);
          }
        }
      }
      const positionsWithAssignments = positions.map((position, index) => {
        const contactId = assignmentsByIndex.get(index);
        return contactId ? { ...position, contactId } : position;
      });
      const recurrenceStarts = occurrenceStarts(row, `${startDate}T00:00`, `${throughDate}T23:59`, 501).map(localDateTime);
      const extraDates = await client.query<{ starts_at: string; ends_at: string }>(
        `SELECT to_char(starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,to_char(ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at
           FROM church_calendar_extra_dates WHERE appointment_id=$1 AND starts_at >= $2::timestamp AND starts_at < ($3::date + 1)::timestamp ORDER BY starts_at LIMIT 501`,
        [row.id, `${startDate}T00:00:00`, throughDate],
      );
      const starts = [...new Set([...recurrenceStarts, ...extraDates.rows.map((extra) => extra.starts_at.replace(" ", "T"))])].sort();
      if (starts.length > 500) { await client.query("ROLLBACK"); return responseError(reply, 400, "That date range contains more than 500 occurrences. Choose an earlier end date."); }
      if (!starts.length) { await client.query("ROLLBACK"); return responseError(reply, 400, "No generated occurrences fall within that date range."); }
      const exceptions = await client.query<{ original_start: string; cancelled: boolean; overrides: Record<string, unknown> }>(
        `SELECT to_char(original_start,'YYYY-MM-DD"T"HH24:MI:SS') AS original_start,cancelled,overrides FROM church_calendar_appointment_exceptions
          WHERE appointment_id=$1 AND original_start >= $2::timestamp AND original_start < ($3::date + 1)::timestamp FOR UPDATE`,
        [row.id, `${startDate}T00:00:00`, throughDate],
      );
      const byStart = new Map(exceptions.rows.map((item) => [item.original_start.replace(" ", "T"), item]));
      const effectiveLink = (start: string) => {
        const override = byStart.get(start)?.overrides ?? {};
        return Object.prototype.hasOwnProperty.call(override, "linkedEventId") ? override.linkedEventId : row.linked_event_id;
      };
      const pending = starts.filter((start) => !byStart.get(start)?.cancelled && !effectiveLink(start));
      const registrationEnabled = request.body.registrationEnabled === true;
      const registrationCapacity = request.body.registrationCapacity ?? null;
      if (!registrationEnabled && registrationCapacity !== null) {
        await client.query("ROLLBACK");
        return responseError(reply, 400, "Enable public registration to set a capacity.");
      }
      if (registrationEnabled && (row.calendar_scope !== "community" || row.internal_only || pending.some((start) => byStart.get(start)?.overrides.internalOnly === true))) {
        await client.query("ROLLBACK");
        return responseError(reply, 400, "Public registration requires a community appointment with no internal occurrences to generate.");
      }
      const duration = wallDate(row.ends_at).getTime() - wallDate(row.starts_at).getTime();
      const locationZone = canonicalTimeZone(row.location_time_zone) ?? "UTC";
      const appointmentZone = row.time_zone ?? locationZone;
      const extraEnds = new Map(extraDates.rows.map((date) => [date.starts_at, date.ends_at]));
      const planned: Array<{ original: string; date: string; startTime: string; endTime: string | null; allDay: boolean }> = [];
      for (const original of pending) {
        const override = byStart.get(original)?.overrides ?? {};
        const allDay = (override.allDay ?? row.all_day) === true;
        const start = cleanLocalDateTime(override.startsAt) ?? original;
        if (allDay) { planned.push({ original, date: start.slice(0, 10), startTime: "00:00", endTime: null, allDay }); continue; }
        const end = cleanLocalDateTime(override.endsAt) ?? extraEnds.get(original) ?? localDateTime(new Date(wallDate(original).getTime() + duration));
        const instants = appointmentInstants(start, end, appointmentZone);
        if (!instants) { await client.query("ROLLBACK"); return responseError(reply, 400, "The appointment duration is not valid for a service event."); }
        const localStart = appointmentWallTime(Date.parse(instants.startsAtUtc), locationZone);
        const localEnd = appointmentWallTime(Date.parse(instants.endsAtUtc), locationZone);
        const date = localStart.slice(0, 10);
        if (localEnd.slice(0, 10) !== date) { await client.query("ROLLBACK"); return responseError(reply, 400, "An appointment occurrence crosses midnight in the location time zone and cannot be converted into a service event."); }
        const startTime = localStart.slice(11, 16);
        const endTime = localEnd.slice(11, 16);
        if (endTime <= startTime) { await client.query("ROLLBACK"); return responseError(reply, 400, "The appointment duration is not valid for a service event."); }
        planned.push({ original, date, startTime, endTime, allDay });
      }
      if (request.body.preview) {
        await client.query("ROLLBACK");
        return { preview: true, occurrences: starts.length, planned: planned.length, alreadyLinked: starts.filter((start) => Boolean(effectiveLink(start))).length, skippedCancelled: starts.filter((start) => Boolean(byStart.get(start)?.cancelled)).length, throughDate };
      }
      let created = 0;
      const staffedPositions = [...assignmentsByIndex];
      const staffedIndexes = staffedPositions.map(([index]) => index);
      const staffedContacts = staffedPositions.map(([, contactId]) => contactId);
      for (const { original: start, date, startTime, endTime, allDay } of planned) {
        const eventId = randomUUID();
        const eventLocation = (row.place || row.calendar_name || "Church").slice(0, 160);
        const eventDescription = row.description.slice(0, 2000) || null;
        await client.query(
          `INSERT INTO service_events(id,department_id,title,kind,event_date,is_all_day,start_time,end_time,location,description,room,asset_ids,positions,time_plan,recurrence_id,registration_enabled,registration_capacity,registration_token)
           VALUES($1,$2,$3,$4,$5::date,$6,$7::time,$8::time,$9,$10,'',ARRAY[]::uuid[],$11::jsonb,$12::jsonb,$13,$14,$15,$16)`,
          [eventId, departmentId, row.title, request.body.kind, date, allDay, startTime, endTime, eventLocation, eventDescription, JSON.stringify(positionsWithAssignments), JSON.stringify(items), row.id, registrationEnabled, registrationCapacity, registrationEnabled ? randomUUID() : null],
        );
        if (staffedPositions.length) {
          await client.query(
            `INSERT INTO event_position_responses(event_id,position_index,contact_id,status)
             SELECT $1, staff.position_index, staff.contact_id, 'pending'
             FROM unnest($2::integer[], $3::uuid[]) AS staff(position_index, contact_id)`,
            [eventId, staffedIndexes, staffedContacts],
          );
        }
        await client.query(
          `INSERT INTO church_calendar_appointment_exceptions(appointment_id,original_start,cancelled,overrides,updated_by)
           VALUES($1,$2::timestamp,false,jsonb_build_object('linkedEventId',$3::text),$4)
           ON CONFLICT(appointment_id,original_start) DO UPDATE SET overrides=church_calendar_appointment_exceptions.overrides || EXCLUDED.overrides,updated_by=EXCLUDED.updated_by,updated_at=now()`,
          [row.id, start, eventId, userId(request)],
        );
        await client.query(
          "INSERT INTO church_calendar_event_generations(id,department_id,appointment_id,occurrence_start,service_event_id,template_id,actor_user_id) VALUES($1,$2,$3,$4::timestamp,$5,$6,$7)",
          [randomUUID(), departmentId, row.id, start, eventId, request.body.templateId, userId(request)],
        );
        created += 1;
      }
      await client.query("COMMIT");
      context.realtime.publish("module:church-calendar:changed", departmentId, { action: "service-events-generated", appointmentId: row.id, created });
      return { preview: false, created, alreadyLinked: starts.filter((start) => Boolean(effectiveLink(start))).length, skippedCancelled: starts.filter((start) => Boolean(byStart.get(start)?.cancelled)).length, throughDate };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.put<{ Params: { id: string }; Body: { filename: string; contentType: string; data: string; metadata?: CalendarImageMetadata } }>("/api/modules/church-calendar/appointments/:id/image", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    body: { type: "object", additionalProperties: false, required: ["filename", "contentType", "data"], properties: { filename: { type: "string", minLength: 1, maxLength: 180 }, contentType: { type: "string", enum: ["image/jpeg", "image/png", "image/gif", "image/webp"] }, data: { type: "string", minLength: 4, maxLength: 1398104 }, metadata: calendarImageMetadataSchema } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const appointment = await context.pool.query<{ scope: CalendarScope; owner_user_id: string | null }>(
      `SELECT calendar.scope,calendar.owner_user_id FROM church_calendar_appointments appointment JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id
        WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL`, [request.params.id, departmentId]);
    const row = appointment.rows[0];
    if (!row) return responseError(reply, 404, "Appointment not found.");
    if (!canManageCalendar(request, row.scope, row.owner_user_id)) return responseError(reply, 403, "You cannot change this appointment image.");
    const metadata = request.body.metadata ? normalizeCalendarImageMetadata(request.body.metadata) : defaultCalendarImageMetadata;
    if (!metadata) return responseError(reply, 400, "Use plain image credit and alternative text and an HTTP or HTTPS source link without credentials.");
    const cleanName = request.body.filename.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim().slice(0, 180) || "appointment-image";
    const data = request.body.data;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) return responseError(reply, 400, "The image data is invalid.");
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length || bytes.length > 1_048_576) return responseError(reply, 400, "Appointment images must be 1 MiB or smaller.");
    const validSignature = request.body.contentType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : request.body.contentType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : request.body.contentType === "image/gif" ? bytes.subarray(0, 3).toString("ascii") === "GIF"
      : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!validSignature) return responseError(reply, 400, "The file contents do not match the selected image type.");
    await context.pool.query(
      `INSERT INTO church_calendar_appointment_images(appointment_id,department_id,content_type,filename,content,uploaded_by,image_metadata,revision)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT(appointment_id) DO UPDATE SET department_id=EXCLUDED.department_id,content_type=EXCLUDED.content_type,
         filename=EXCLUDED.filename,content=EXCLUDED.content,uploaded_by=EXCLUDED.uploaded_by,updated_at=now(),
         image_metadata=EXCLUDED.image_metadata,revision=EXCLUDED.revision`,
      [request.params.id, departmentId, request.body.contentType, cleanName, bytes, userId(request), JSON.stringify(metadata), randomUUID()],
    );
    context.realtime.publish("module:church-calendar:changed", departmentId, { action: "appointment-image-updated", appointmentId: request.params.id });
    return { imageUrl: `/api/modules/church-calendar/appointments/${request.params.id}/image` };
  });

  app.delete<{ Params: { id: string } }>("/api/modules/church-calendar/appointments/:id/image", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const appointment = await context.pool.query<{ scope: CalendarScope; owner_user_id: string | null }>(
      `SELECT calendar.scope,calendar.owner_user_id FROM church_calendar_appointments appointment JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL`, [request.params.id, departmentId]);
    if (!appointment.rows[0]) return responseError(reply, 404, "Appointment not found.");
    if (!canManageCalendar(request, appointment.rows[0].scope, appointment.rows[0].owner_user_id)) return responseError(reply, 403, "You cannot change this appointment image.");
    await context.pool.query("DELETE FROM church_calendar_appointment_images WHERE appointment_id=$1 AND department_id=$2", [request.params.id, departmentId]);
    context.realtime.publish("module:church-calendar:changed", departmentId, { action: "appointment-image-removed", appointmentId: request.params.id });
    return { removed: true };
  });

  const imageAudience = `WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL
         AND (calendar.scope='community' OR calendar.owner_user_id=$3 OR (calendar.scope='group' AND ($4 OR EXISTS(
           SELECT 1 FROM department_memberships membership JOIN group_members member ON member.contact_id=membership.contact_id
            WHERE membership.user_id=$3 AND membership.department_id=$2 AND member.group_id=calendar.group_id AND member.status='active'))))`;

  app.get<{ Params: { id: string } }>("/api/modules/church-calendar/appointments/:id/image/metadata", {
    schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await context.pool.query<{ image_metadata: unknown; revision: string }>(
      `SELECT image.image_metadata,image.revision FROM church_calendar_appointment_images image
        JOIN church_calendar_appointments appointment ON appointment.id=image.appointment_id AND appointment.department_id=image.department_id
        JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
        ${imageAudience}`, [request.params.id, departmentId, userId(request), hasGroupVisibility(request)],
    );
    const image = result.rows[0];
    if (!image) return responseError(reply, 404, "Appointment image not found.");
    return reply.header("Cache-Control", "private, no-store").send({
      metadata: normalizeCalendarImageMetadata(image.image_metadata) ?? defaultCalendarImageMetadata, revision: image.revision,
    });
  });

  app.patch<{ Params: { id: string }; Body: { revision: string; metadata: CalendarImageMetadata } }>(
    "/api/modules/church-calendar/appointments/:id/image/metadata", { schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["revision", "metadata"],
        properties: { revision: { type: "string", format: "uuid" }, metadata: calendarImageMetadataSchema } },
    } }, async (request, reply) => {
      if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
      if (!context.validateMutation(request, reply)) return reply;
      const departmentId = await context.resolveDepartmentId(request, reply);
      if (!departmentId) return reply;
      const metadata = normalizeCalendarImageMetadata(request.body.metadata);
      if (!metadata) return responseError(reply, 400, "Use plain image credit and alternative text and an HTTP or HTTPS source link without credentials.");
      const client = await context.pool.connect();
      try {
        await client.query("BEGIN");
        if (!await context.lockDepartmentForWrite(client, departmentId)) {
          await client.query("ROLLBACK");
          return responseError(reply, 409, "This location is read-only on this installation.");
        }
        const selected = await client.query<{ scope: CalendarScope; owner_user_id: string | null }>(
          `SELECT calendar.scope,calendar.owner_user_id FROM church_calendar_appointments appointment
            JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
            ${imageAudience} FOR SHARE OF appointment,calendar`, [request.params.id, departmentId, userId(request), hasGroupVisibility(request)],
        );
        const owner = selected.rows[0];
        if (!owner || !canManageCalendar(request, owner.scope, owner.owner_user_id)) {
          await client.query("ROLLBACK");
          return responseError(reply, owner ? 403 : 404, owner ? "You cannot change this appointment image." : "Appointment image not found.");
        }
        const revision = randomUUID();
        const updated = await client.query(
          `UPDATE church_calendar_appointment_images SET image_metadata=$4::jsonb,revision=$5,updated_at=now()
            WHERE appointment_id=$1 AND department_id=$2 AND revision=$3`,
          [request.params.id, departmentId, request.body.revision, JSON.stringify(metadata), revision],
        );
        if (!updated.rowCount) {
          await client.query("ROLLBACK");
          return responseError(reply, 409, "This image was changed or removed. Reload the image and try again.");
        }
        await client.query("COMMIT");
        context.realtime.publish("module:church-calendar:changed", departmentId, { action: "appointment-image-metadata-updated", appointmentId: request.params.id });
        return { metadata, revision };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
  );

  app.get<{ Params: { id: string } }>("/api/modules/church-calendar/appointments/:id/image", async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const image = await context.pool.query<{ content: Buffer; content_type: string; filename: string; revision: string }>(
      `SELECT image.content,image.content_type,image.filename,image.revision FROM church_calendar_appointment_images image
        JOIN church_calendar_appointments appointment ON appointment.id=image.appointment_id AND appointment.department_id=image.department_id
        JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
        ${imageAudience}`,
      [request.params.id, departmentId, userId(request), hasGroupVisibility(request)]);
    const file = image.rows[0];
    if (!file) return responseError(reply, 404, "Appointment image not found.");
    return reply.type(file.content_type).header("Content-Disposition", `inline; filename="${file.filename.replace(/["\\\r\n]/g, "_")}"`).header("Cache-Control", "private, no-store").header("X-Calendar-Image-Revision", file.revision).send(file.content);
  });

  app.post<{ Body: AppointmentInput & { createEventTemplateId?: string; newResourceBookings?: ResourceSelection[]; newSignupGroup?: { templateGroupId?: string; throughDate?: string } } }>("/api/modules/church-calendar/appointments", { schema: { body: {
    type: "object", additionalProperties: false, required: ["calendarId", "title", "startsAt", "endsAt"],
    properties: { newSignupGroup: { type: "object", additionalProperties: false, properties: { templateGroupId: { type: "string", format: "uuid" }, throughDate: { type: "string", format: "date" } } }, newResourceBookings: resourceSelectionListSchema, createEventTemplateId: { type: "string", format: "uuid" }, calendarId: { type: "string", format: "uuid" }, title: { type: "string", minLength: 1, maxLength: 160 }, subtitle: { type: "string", maxLength: 240 }, description: { type: "string", maxLength: 8000 }, startsAt: { type: "string", minLength: 16, maxLength: 25 }, endsAt: { type: "string", minLength: 16, maxLength: 25 }, allDay: { type: "boolean" }, place: { type: "string", maxLength: 200 }, url: { type: "string", maxLength: 1000 }, internalOnly: { type: "boolean" }, tags: { type: "array", maxItems: 30, items: { type: "string", maxLength: 40 } }, recurrence: { type: ["object", "null"] }, linkedEventId: { type: ["string", "null"], format: "uuid" }, resourceBookingIds: { type: "array", maxItems: 10, items: { type: "string", format: "uuid" } }, signupGroupId: { type: ["string", "null"], format: "uuid" }, responsibleContactId: { type: ["string", "null"], format: "uuid" }, timeZone: { type: ["string", "null"], maxLength: 80 } },
  } } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const normalized = normalizeInput(request.body);
    if (typeof normalized === "string") return responseError(reply, 400, normalized);
    if ("responsibleContactId" in request.body) {
      if (!canSeePrivatePeople(request)) return responseError(reply, 403, "Private People access is required to set an appointment contact.");
      if (normalized.responsibleContactId) {
        const person = await context.pool.query("SELECT 1 FROM contacts WHERE id=$1 AND department_id=$2", [normalized.responsibleContactId, departmentId]);
        if (!person.rowCount) return responseError(reply, 400, "Choose a People record from this location.");
      }
    }
    const calendarResult = await context.pool.query<{ scope: CalendarScope; owner_user_id: string | null; time_zone: string }>(
      `SELECT calendar.scope,calendar.owner_user_id,department.time_zone
         FROM church_calendar_calendars calendar JOIN departments department ON department.id=calendar.department_id
        WHERE calendar.id=$1 AND calendar.department_id=$2 AND calendar.archived_at IS NULL`,
      [normalized.calendarId, departmentId],
    );
    const calendar = calendarResult.rows[0];
    if (!calendar) return responseError(reply, 404, "The calendar was not found.");
    const isContributor = !canManageCalendar(request, calendar.scope, calendar.owner_user_id);
    const createEventTemplateId = request.body.createEventTemplateId;
    const newSignupGroup = request.body.newSignupGroup;
    let signupOccurrenceStarts: string[] = [];
    if (newSignupGroup) {
      if (isContributor || !(request.activeDepartmentRole === "site_admin" || (request.activeDepartmentPermissions ?? []).includes("groups_manage"))) {
        return responseError(reply, 403, "Calendar and group management access is required to create a registration group.");
      }
      if (calendar.scope !== "community" || normalized.internalOnly || normalized.signupGroupId) {
        return responseError(reply, 400, "Create registration groups from a community appointment without an existing signup link or internal visibility.");
      }
      const throughDate = newSignupGroup.throughDate;
      if (normalized.recurrence) {
        const startDate = normalized.startsAt.slice(0, 10);
        const last = wallDate(startDate + "T00:00:00");
        last.setUTCFullYear(last.getUTCFullYear() + 5);
        if (!throughDate || !cleanLocalDateTime(throughDate + "T00:00:00") || throughDate < startDate || throughDate > localDateTime(last).slice(0, 10)) {
          return responseError(reply, 400, "Choose a registration end date from the series start through five years ahead.");
        }
        signupOccurrenceStarts = occurrenceStarts(
          { starts_at: normalized.startsAt, recurrence: normalized.recurrence },
          startDate + "T00:00:00", throughDate + "T23:59:59", 501,
        ).map(localDateTime);
        if (signupOccurrenceStarts.length > 500) {
          return responseError(reply, 400, "Choose a registration range containing at most 500 occurrences.");
        }
        if (!signupOccurrenceStarts.length) {
          return responseError(reply, 400, "No occurrences fall within the registration range.");
        }
      } else if (throughDate) {
        return responseError(reply, 400, "A registration end date applies only to a repeating appointment.");
      }
    }
    const newResourceBookings = request.body.newResourceBookings;
    if (newResourceBookings) {
      if (isContributor || calendar.scope === "personal") return responseError(reply, 403, "Shared calendar management is required to book resources with an appointment.");
    }
    if (createEventTemplateId) {
      if (isContributor || !canManageServiceEvents(request)) {
        return responseError(reply, 403, "Calendar and event management access is required to create a linked event.");
      }
      if (calendar.scope !== "community" || normalized.internalOnly || normalized.recurrence || normalized.linkedEventId) {
        return responseError(reply, 400, "Create a linked event from a one-time community appointment without an existing event link or internal visibility.");
      }
    }
    if (isContributor) {
      const contribution = await context.pool.query(`SELECT 1 ${calendarGroupContributors} LIMIT 1`, [normalized.calendarId, departmentId, userId(request)]);
      if (!contribution.rowCount) return responseError(reply, 403, "You do not have permission to add appointments to this calendar.");
      if (normalized.linkedEventId || normalized.signupGroupId || normalized.resourceBookingIds?.length || normalized.responsibleContactId) {
        return responseError(reply, 403, "Calendar managers must add event, signup, resource and contact links.");
      }
    }
    if (normalized.timeZone !== undefined && !validAppointmentTimes(normalized, normalized.timeZone ?? canonicalTimeZone(calendar.time_zone))) return responseError(reply, 400, invalidAppointmentTime);
    if (normalized.linkedEventId) {
      const event = await context.pool.query("SELECT id FROM service_events WHERE id=$1 AND department_id=$2", [normalized.linkedEventId, departmentId]);
      if (!event.rowCount) return responseError(reply, 400, "The linked event does not belong to this location.");
    }
    if (normalized.signupGroupId) {
      const group = await context.pool.query("SELECT id FROM church_groups WHERE id=$1 AND department_id=$2 AND status='active' AND public_signup_enabled=true AND public_signup_token IS NOT NULL AND source_system IS NULL", [normalized.signupGroupId, departmentId]);
      if (!group.rowCount) return responseError(reply, 400, "Choose an active public-signup group in this location.");
    }
    const resourceIds = [...new Set(normalized.resourceBookingIds ?? [])];
    if (resourceIds.length) {
      const canManageResources = isResourceBookingManager(request, isServerModuleEnabled("resource-scheduler"));
      const found = await context.pool.query("SELECT id FROM resource_bookings WHERE id=ANY($1::uuid[]) AND department_id=$2 AND status='approved' AND ($3 OR requested_by=$4)", [resourceIds, departmentId, canManageResources, userId(request)]);
      if (found.rowCount !== resourceIds.length) return responseError(reply, 400, "One or more resource bookings are outside this location or unavailable.");
    }
    const id = randomUUID();
    let linkedEventId = normalized.linkedEventId ?? null;
    let signupGroupId = normalized.signupGroupId ?? null;
    const createdSignupGroupIds: string[] = [];
    let bookings: CalendarCreatedBooking[] | undefined;
    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      if ((isContributor || createEventTemplateId || newResourceBookings || newSignupGroup) && !await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return responseError(reply, 409, "This location is read-only on this installation.");
      }
      if (isContributor) {
        const contribution = await client.query(
          `SELECT 1 ${calendarGroupContributors} FOR SHARE OF calendar,church_group,membership,member`,
          [normalized.calendarId, departmentId, userId(request)],
        );
        if (!contribution.rowCount) {
          await client.query("ROLLBACK");
          return responseError(reply, 403, "You no longer have permission to add appointments to this calendar.");
        }
      }
      if (newSignupGroup) {
        const target = await client.query(
          `SELECT 1 FROM church_calendar_calendars calendar JOIN departments site ON site.id=calendar.department_id
            WHERE calendar.id=$1 AND calendar.department_id=$2 AND calendar.scope='community' AND calendar.archived_at IS NULL
              AND 'community'=ANY(site.enabled_modules) FOR SHARE OF calendar`, [normalized.calendarId, departmentId],
        );
        if (!target.rowCount || !isServerModuleEnabled("community")) {
          await client.query("ROLLBACK");
          return responseError(reply, 409, "An active community calendar and Groups are required at this location.");
        }
        const templateGroupId = newSignupGroup.templateGroupId;
        if (templateGroupId) {
          const problem = await lockRegistrationTemplate(client, departmentId, templateGroupId);
          if (problem) { await client.query("ROLLBACK"); return responseError(reply, problem.status, problem.error); }
        }
        await client.query("SELECT set_config('smart_church.actor_id',$1,true)", [userId(request)]);
        if (!normalized.recurrence) {
          signupGroupId = await createDraftRegistrationGroup(client, departmentId, id, normalized.title, normalized.startsAt);
          createdSignupGroupIds.push(signupGroupId);
        }
      }
      if (createEventTemplateId) {
        const eligible = await client.query<{ name: string; time_zone: string; services_enabled: boolean }>(
          `SELECT calendar.name, department.time_zone, 'community'=ANY(department.enabled_modules) AS services_enabled
             FROM church_calendar_calendars calendar JOIN departments department ON department.id=calendar.department_id
            WHERE calendar.id=$1 AND calendar.department_id=$2 AND calendar.scope='community' AND calendar.archived_at IS NULL
             FOR SHARE OF calendar`, [normalized.calendarId, departmentId],
        );
        const target = eligible.rows[0];
        if (!target?.services_enabled || !isServerModuleEnabled("community")) {
          await client.query("ROLLBACK");
          return responseError(reply, 409, "An active community calendar and Services & events are required at this location.");
        }
        const locationZone = canonicalTimeZone(target.time_zone) ?? "UTC";
        const authoredZone = normalized.timeZone ?? locationZone;
        const instants = normalized.allDay ? null : appointmentInstants(normalized.startsAt, normalized.endsAt, authoredZone);
        const localStart = instants ? appointmentWallTime(Date.parse(instants.startsAtUtc), locationZone) : normalized.startsAt;
        const localEnd = instants ? appointmentWallTime(Date.parse(instants.endsAtUtc), locationZone) : normalized.endsAt;
        const eventDate = localStart.slice(0, 10);
        const startTime = normalized.allDay ? "00:00" : localStart.slice(11, 16);
        const endTime = normalized.allDay ? null : localEnd.slice(11, 16);
        const allDayEndsOnNextMidnight = normalized.allDay
          && localEnd === localDateTime(addDays(startOfDay(localStart), 1));
        if ((!normalized.allDay && (!instants || instants.shifted || !endTime || endTime <= startTime))
          || (localEnd.slice(0, 10) !== eventDate && !allDayEndsOnNextMidnight)) {
          await client.query("ROLLBACK");
          return responseError(reply, 400, "The appointment must fit on one location calendar day to create a linked event.");
        }
        const template = await loadCalendarEventTemplate(client, departmentId, createEventTemplateId);
        if (template.error !== undefined) {
          await client.query("ROLLBACK");
          return responseError(reply, template.status, template.error);
        }
        linkedEventId = randomUUID();
        await client.query(
          `INSERT INTO service_events(id,department_id,title,kind,event_date,is_all_day,start_time,end_time,location,description,room,asset_ids,positions,time_plan)
           VALUES($1,$2,$3,'service',$4::date,$5,$6::time,$7::time,$8,$9,'',ARRAY[]::uuid[],$10::jsonb,$11::jsonb)`,
          [linkedEventId, departmentId, normalized.title, eventDate, normalized.allDay ?? false, startTime, endTime,
            (normalized.place || target.name || "Church").slice(0, 160), normalized.description?.slice(0, 2000) || null,
            JSON.stringify(template.positions), JSON.stringify(template.items)],
        );
      }
      await client.query(
        `INSERT INTO church_calendar_appointments(id,department_id,calendar_id,title,subtitle,description,starts_at,ends_at,all_day,place,url,internal_only,tags,recurrence,linked_event_id,signup_group_id,responsible_contact_id,created_by,time_zone)
         VALUES($1,$2,$3,$4,$5,$6,$7::timestamp,$8::timestamp,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19)`,
        [id, departmentId, normalized.calendarId, normalized.title, normalized.subtitle, normalized.description, normalized.startsAt, normalized.endsAt, normalized.allDay ?? false, normalized.place, normalized.url, normalized.internalOnly ?? false, normalized.tags, normalized.recurrence ? JSON.stringify(normalized.recurrence) : null, linkedEventId, signupGroupId, canSeePrivatePeople(request) ? normalized.responsibleContactId ?? null : null, userId(request), normalized.timeZone ?? null],
      );
      for (const start of signupOccurrenceStarts) {
        const groupId = await createDraftRegistrationGroup(client, departmentId, id, normalized.title, start);
        await client.query(
          `INSERT INTO church_calendar_appointment_exceptions(appointment_id,original_start,cancelled,overrides,updated_by)
           VALUES($1,$2::timestamp,false,jsonb_build_object('signupGroupId',$3::text),$4)`,
          [id, start, groupId, userId(request)],
        );
        createdSignupGroupIds.push(groupId);
      }
      if (newSignupGroup?.templateGroupId) {
        await copyRegistrationForm(client, departmentId, newSignupGroup.templateGroupId, createdSignupGroupIds);
      }
      if (createEventTemplateId && linkedEventId) {
        await client.query(
          "INSERT INTO church_calendar_event_generations(id,department_id,appointment_id,occurrence_start,service_event_id,template_id,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [randomUUID(), departmentId, id, normalized.startsAt, linkedEventId, createEventTemplateId, userId(request)],
        );
      }
      if (newResourceBookings) {
        const result = await addResourcesToNewCalendarAppointment(client, {
          departmentId, calendarId: normalized.calendarId, appointmentId: id, userId: userId(request),
          canManageResources: isResourceBookingManager(request, isServerModuleEnabled("resource-scheduler")),
          startsAt: normalized.startsAt, endsAt: normalized.endsAt, authoredTimeZone: normalized.timeZone,
          allDay: normalized.allDay ?? false, privateTitle: calendar.scope === "group" || normalized.internalOnly === true,
          title: normalized.title, selections: newResourceBookings, recurrence: normalized.recurrence,
        });
        if (result.error !== undefined) {
          await client.query("ROLLBACK");
          return responseError(reply, result.status, result.error);
        }
        bookings = result.bookings;
      }
      for (const resourceId of resourceIds) await client.query("INSERT INTO church_calendar_resource_links(appointment_id,resource_booking_id,created_by) VALUES($1,$2,$3)", [id, resourceId, userId(request)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    context.realtime.publish("module:church-calendar:changed", departmentId, { action: "appointment-created", appointmentId: id });
    if (createdSignupGroupIds.length) context.realtime.publish("core:groups:changed", departmentId, {
      action: "registration-group-created", groupId: signupGroupId, count: createdSignupGroupIds.length,
    });
    if (bookings?.length) context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
    return reply.code(201).send({ id, ...(createEventTemplateId ? { linkedEventId } : {}), ...(bookings ? { bookings } : {}), ...(newSignupGroup ? { ...(signupGroupId ? { signupGroupId } : {}), signupGroupCount: createdSignupGroupIds.length } : {}) });
  });

  app.get("/api/modules/church-calendar/archive", async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await context.pool.query(
      `SELECT appointment.id AS "appointmentId",appointment.title,to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "startsAt",
              calendar.id AS "calendarId",calendar.name AS "calendarName",calendar.scope AS "calendarScope",calendar.owner_user_id AS "ownerUserId"
         FROM church_calendar_appointments appointment JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id
        WHERE appointment.department_id=$1 AND appointment.archived_at IS NOT NULL AND calendar.archived_at IS NULL
          AND (calendar.scope='community' OR calendar.owner_user_id=$2 OR (calendar.scope='group' AND ($3 OR EXISTS (
            SELECT 1 FROM department_memberships membership JOIN group_members member ON member.contact_id=membership.contact_id
             WHERE membership.user_id=$2 AND membership.department_id=$1 AND member.group_id=calendar.group_id AND member.status='active'))))
        ORDER BY appointment.archived_at DESC LIMIT 250`, [departmentId, userId(request), hasGroupVisibility(request)]);
    return result.rows.filter((row) => canManageCalendar(request, row.calendarScope, row.ownerUserId));
  });

  app.post<{ Params: { id: string } }>("/api/modules/church-calendar/appointments/:id/restore", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await context.pool.query<{ calendar_scope: CalendarScope; owner_user_id: string | null }>(
      `SELECT calendar.scope AS calendar_scope,calendar.owner_user_id FROM church_calendar_appointments appointment JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id
        WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NOT NULL`, [request.params.id, departmentId]);
    const row = result.rows[0];
    if (!row) return responseError(reply, 404, "The archived appointment was not found.");
    if (!canManageCalendar(request, row.calendar_scope, row.owner_user_id)) return responseError(reply, 403, "You do not have permission to restore this appointment.");
    await context.pool.query("UPDATE church_calendar_appointments SET archived_at=NULL,updated_at=now() WHERE id=$1 AND department_id=$2", [request.params.id, departmentId]);
    context.realtime.publish("module:church-calendar:changed", departmentId, { action: "appointment-restored", appointmentId: request.params.id });
    return { restored: true };
  });

  app.put<{ Params: { id: string }; Querystring: { scope?: "occurrence" | "future" | "series" }; Body: AppointmentInput & { occurrenceStartAt?: string; notifyCreator?: boolean } }>("/api/modules/church-calendar/appointments/:id", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    querystring: { type: "object", additionalProperties: false, properties: { scope: { type: "string", enum: ["occurrence", "future", "series"] } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    if (request.body.notifyCreator !== undefined && typeof request.body.notifyCreator !== "boolean") {
      return responseError(reply, 400, "Choose whether to notify the appointment creator.");
    }
    const normalized = normalizeInput(request.body);
    if (typeof normalized === "string") return responseError(reply, 400, normalized);
    const found = await context.pool.query<AppointmentRow>(
      `SELECT appointment.id,appointment.calendar_id,appointment.title,appointment.subtitle,appointment.description,to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,to_char(appointment.ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at,appointment.all_day,appointment.place,appointment.url,appointment.internal_only,appointment.tags,appointment.recurrence,appointment.linked_event_id,appointment.signup_group_id,appointment.responsible_contact_id,appointment.time_zone,department.time_zone AS location_time_zone,appointment.created_by,calendar.scope AS calendar_scope,calendar.name AS calendar_name,calendar.owner_user_id,calendar.group_id FROM church_calendar_appointments appointment JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id JOIN departments department ON department.id=appointment.department_id WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL`, [request.params.id, departmentId]);
    const row = found.rows[0];
    if (!row) return responseError(reply, 404, "The appointment was not found.");
    if (!canManageCalendar(request, row.calendar_scope, row.owner_user_id)) return responseError(reply, 403, "You do not have permission to edit this appointment.");
    if ("responsibleContactId" in request.body) {
      if (!canSeePrivatePeople(request)) return responseError(reply, 403, "Private People access is required to set an appointment contact.");
      if (normalized.responsibleContactId) {
        const person = await context.pool.query("SELECT 1 FROM contacts WHERE id=$1 AND department_id=$2", [normalized.responsibleContactId, departmentId]);
        if (!person.rowCount) return responseError(reply, 400, "Choose a People record from this location.");
      }
    }
    if (normalized.linkedEventId) {
      const event = await context.pool.query("SELECT id FROM service_events WHERE id=$1 AND department_id=$2", [normalized.linkedEventId, departmentId]);
      if (!event.rowCount) return responseError(reply, 400, "The linked event does not belong to this location.");
    }
    const scope = request.query.scope ?? "series";
    const occurrenceStart = cleanLocalDateTime(request.body.occurrenceStartAt);
    if (normalized.signupGroupId) {
      const group = await context.pool.query(`SELECT id FROM church_groups WHERE id=$1 AND department_id=$2
        AND (status='active' OR (status='draft' AND (id=$3 OR ($4::boolean AND EXISTS (
          SELECT 1 FROM church_calendar_appointment_exceptions
           WHERE appointment_id=$5 AND original_start=$6::timestamp AND NOT cancelled
             AND overrides->>'signupGroupId'=church_groups.id::text
        ))))) AND source_system IS NULL`,
        [normalized.signupGroupId, departmentId, row.signup_group_id ?? null,
          Boolean(row.recurrence && scope !== "series" && occurrenceStart), row.id, occurrenceStart]);
      if (!group.rowCount) return responseError(reply, 400, "Choose a local group in this location.");
    }
    const values = normalized;
    const updateSeriesLinks = normalized.resourceBookingIds !== undefined && !(scope === "occurrence" && row.recurrence);
    const timeZone = normalized.timeZone === undefined ? row.time_zone ?? null : normalized.timeZone;
    const effectiveZone = timeZone ?? (normalized.timeZone === null ? canonicalTimeZone(row.location_time_zone) : null);
    if (!validAppointmentTimes(normalized, effectiveZone)) return responseError(reply, 400, invalidAppointmentTime);
    if (scope === "occurrence" && row.recurrence && normalized.timeZone !== undefined && timeZone !== (row.time_zone ?? null)) {
      return responseError(reply, 400, "Change the time zone for the whole series or future occurrences.");
    }
    const resourceIds = [...new Set(normalized.resourceBookingIds ?? [])];
    if (updateSeriesLinks && resourceIds.length) {
      const canManageResources = isResourceBookingManager(request, isServerModuleEnabled("resource-scheduler"));
      const resourceRows = await context.pool.query("SELECT id FROM resource_bookings WHERE id=ANY($1::uuid[]) AND department_id=$2 AND status='approved' AND ($3 OR requested_by=$4)", [resourceIds, departmentId, canManageResources, userId(request)]);
      if (resourceRows.rowCount !== resourceIds.length) return responseError(reply, 400, "One or more resource bookings are outside this location or unavailable.");
    }
    if (scope === "occurrence" && row.recurrence && !occurrenceStart) return responseError(reply, 400, "Choose which occurrence to edit.");
    if (scope === "future" && row.recurrence && (!occurrenceStart || occurrenceStart <= row.starts_at)) {
      return responseError(reply, 400, "Choose an occurrence after the first appointment to split the series.");
    }
    const client = await context.pool.connect();
    let futureAppointmentId: string | undefined;
    let creatorNotificationQueued = false;
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return responseError(reply, 423, "This location is read-only.");
      }
      const current = await client.query<{ scope: CalendarScope; owner_user_id: string | null }>(
        `SELECT calendar.scope,calendar.owner_user_id FROM church_calendar_appointments appointment
         JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
         WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL
         FOR UPDATE OF appointment FOR SHARE OF calendar`, [row.id, departmentId],
      );
      if (!current.rows[0] || !canManageCalendar(request, current.rows[0].scope, current.rows[0].owner_user_id)) {
        await client.query("ROLLBACK");
        return responseError(reply, 409, "The appointment changed. Open it again before saving.");
      }
      if (scope === "occurrence" && row.recurrence) {
        const overrides = Object.fromEntries(calendarFields.filter((field) => field in values).map((field) => [field, values[field]]));
        if (!canSeePrivatePeople(request) && !("responsibleContactId" in request.body)) {
          const existing = await client.query<{ overrides: Record<string, unknown> }>(
            "SELECT overrides FROM church_calendar_appointment_exceptions WHERE appointment_id=$1 AND original_start=$2::timestamp",
            [row.id, occurrenceStart],
          );
          if (existing.rows[0]?.overrides && Object.prototype.hasOwnProperty.call(existing.rows[0].overrides, "responsibleContactId")) {
            const retainedResponsibleContactId = existing.rows[0].overrides.responsibleContactId;
            overrides.responsibleContactId = typeof retainedResponsibleContactId === "string" && /^[0-9a-f-]{36}$/i.test(retainedResponsibleContactId) ? retainedResponsibleContactId : null;
          }
        }
        await client.query(
          `INSERT INTO church_calendar_appointment_exceptions(appointment_id,original_start,cancelled,overrides,updated_by) VALUES($1,$2::timestamp,false,$3::jsonb,$4)
           ON CONFLICT(appointment_id,original_start) DO UPDATE SET cancelled=false,overrides=EXCLUDED.overrides,updated_by=EXCLUDED.updated_by,updated_at=now()`,
          [row.id, occurrenceStart, JSON.stringify(overrides), userId(request)],
        );
      } else if (scope === "future" && row.recurrence) {
        const next = { startsAt: normalized.startsAt, endsAt: normalized.endsAt };
        futureAppointmentId = randomUUID();
        const newId = futureAppointmentId;
        const locked = await lockCalendarSeries(client, row.id, departmentId);
        if (!locked || locked.starts_at !== row.starts_at || locked.ends_at !== row.ends_at
          || JSON.stringify(locked.recurrence) !== JSON.stringify(row.recurrence)) {
          await client.query("ROLLBACK");
          return responseError(reply, 409, "The series changed. Open the occurrence again before splitting it.");
        }
        const { rows: extras } = await client.query<ExplicitDate>(
          `SELECT to_char(starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "startsAt",to_char(ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "endsAt"
             FROM church_calendar_extra_dates WHERE appointment_id=$1 FOR UPDATE`, [row.id],
        );
        const plan = planCalendarSeriesSplit(locked, occurrenceStart!, next, normalized.recurrence ?? row.recurrence, extras);
        if (!plan) {
          await client.query("ROLLBACK");
          return responseError(reply, 409, "Choose an existing occurrence and a new start time that does not duplicate a neighboring occurrence.");
        }
        const { rows: [selected] } = await client.query<{ cancelled: boolean; overrides: Record<string, unknown> }>(
          "SELECT cancelled,overrides FROM church_calendar_appointment_exceptions WHERE appointment_id=$1 AND original_start=$2::timestamp FOR UPDATE",
          [row.id, occurrenceStart],
        );
        if (selected?.cancelled) {
          await client.query("ROLLBACK");
          return responseError(reply, 409, "Choose an active occurrence to split the series.");
        }
        const selectedOverrides = { ...selected?.overrides };
        function resolveSeriesLink(key: "linkedEventId" | "signupGroupId" | "responsibleContactId", original: string | null) {
          const proposed = values[key];
          if (proposed === undefined || (Object.hasOwn(selectedOverrides, key) && proposed === selectedOverrides[key])) return original;
          delete selectedOverrides[key];
          return proposed;
        }
        const eventId = resolveSeriesLink("linkedEventId", row.linked_event_id);
        const signupGroupId = resolveSeriesLink("signupGroupId", row.signup_group_id ?? null);
        const responsibleContactId = resolveSeriesLink("responsibleContactId", row.responsible_contact_id ?? null);
        for (const field of calendarFields) {
          if (field !== "linkedEventId" && field !== "signupGroupId" && field !== "responsibleContactId") delete selectedOverrides[field];
        }
        await client.query("UPDATE church_calendar_appointments SET recurrence=$2::jsonb,updated_at=now() WHERE id=$1", [row.id, JSON.stringify(plan.previousRule)]);
        await client.query("DELETE FROM church_calendar_meeting_requests WHERE appointment_id=$1 AND original_start >= $2::timestamp", [row.id, occurrenceStart]);
        await client.query(
          `INSERT INTO church_calendar_appointments(id,department_id,calendar_id,title,subtitle,description,starts_at,ends_at,all_day,place,url,internal_only,tags,recurrence,linked_event_id,signup_group_id,responsible_contact_id,created_by,time_zone)
           VALUES($1,$2,$3,$4,$5,$6,$7::timestamp,$8::timestamp,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19)`,
          [newId, departmentId, row.calendar_id, values.title, values.subtitle, values.description, next.startsAt, next.endsAt, values.allDay ?? false, values.place, values.url, values.internalOnly ?? false, values.tags, JSON.stringify(plan.futureRule), eventId, signupGroupId, responsibleContactId, userId(request), timeZone],
        );
        await client.query("UPDATE church_calendar_extra_dates SET appointment_id=$2 WHERE appointment_id=$1 AND starts_at>$3::timestamp", [row.id, newId, occurrenceStart]);
        await client.query("DELETE FROM church_calendar_extra_dates WHERE appointment_id=$1 AND starts_at=$2::timestamp", [row.id, occurrenceStart]);
        if (plan.addedExtras.length) await client.query(
          `INSERT INTO church_calendar_extra_dates(appointment_id,starts_at,ends_at,created_by)
           SELECT $1,dates."startsAt",dates."endsAt",$2 FROM jsonb_to_recordset($3::jsonb) AS dates("startsAt" timestamp,"endsAt" timestamp)`,
          [newId, userId(request), JSON.stringify(plan.addedExtras)],
        );
        await moveCalendarOccurrenceLinks(client, row.id, newId, occurrenceStart!, selectedOverrides, plan.targetOccurrence);
        await client.query(
          `INSERT INTO church_calendar_resource_links(appointment_id,resource_booking_id,created_by,historical_actor_id,historical_actor_name)
           SELECT $2,resource_booking_id,created_by,historical_actor_id,historical_actor_name FROM church_calendar_resource_links WHERE appointment_id=$1 AND occurrence_start IS NULL`, [row.id, newId],
        );
      } else {
        const currentOccurrenceStart = cleanLocalDateTime(request.body.occurrenceStartAt);
        const seriesStart = currentOccurrenceStart ? new Date(wallDate(row.starts_at).getTime() + wallDate(normalized.startsAt).getTime() - wallDate(currentOccurrenceStart).getTime()) : wallDate(normalized.startsAt);
        const seriesStartAt = localDateTime(seriesStart);
        const seriesDuration = Math.max(0, wallDate(normalized.endsAt).getTime() - wallDate(normalized.startsAt).getTime());
        const seriesEndAt = localDateTime(new Date(seriesStart.getTime() + seriesDuration));
        await client.query(
          "DELETE FROM church_calendar_meeting_requests WHERE appointment_id=$1 AND EXISTS (SELECT 1 FROM church_calendar_appointments WHERE id=$1 AND recurrence IS DISTINCT FROM $2::jsonb)",
          [row.id, normalized.recurrence ? JSON.stringify(normalized.recurrence) : null],
        );
        await client.query(
          `WITH changed AS (
             UPDATE church_calendar_appointments SET title=$3,subtitle=$4,description=$5,starts_at=$6::timestamp,ends_at=$7::timestamp,all_day=$8,place=$9,url=$10,internal_only=$11,tags=$12,recurrence=$13::jsonb,linked_event_id=$14,signup_group_id=$15,responsible_contact_id=$16,time_zone=$17,updated_at=now()
              WHERE id=$1 AND department_id=$2 RETURNING id
           ) UPDATE church_calendar_resource_links link SET occurrence_start=$6::timestamp
              FROM changed WHERE link.appointment_id=changed.id AND link.occurrence_start=$18::timestamp`,
          [row.id, departmentId, values.title, values.subtitle, values.description, row.recurrence ? seriesStartAt : values.startsAt, row.recurrence ? seriesEndAt : values.endsAt, values.allDay ?? false, values.place, values.url, values.internalOnly ?? false, values.tags, normalized.recurrence ? JSON.stringify(normalized.recurrence) : null, values.linkedEventId ?? null, values.signupGroupId === undefined ? row.signup_group_id ?? null : values.signupGroupId, "responsibleContactId" in request.body ? normalized.responsibleContactId ?? null : row.responsible_contact_id ?? null, timeZone, row.recurrence ? null : row.starts_at],
        );
      }
      if (updateSeriesLinks) await updateCalendarSeriesResources(client, futureAppointmentId ?? row.id, resourceIds, userId(request), isResourceBookingManager(request, isServerModuleEnabled("resource-scheduler")));
      if (request.body.notifyCreator) creatorNotificationQueued = await notifyAppointmentCreator(client, departmentId, row.id, userId(request));
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    context.realtime.publish("module:church-calendar:changed", departmentId, { action: "appointment-updated", appointmentId: row.id, ...(futureAppointmentId ? { futureAppointmentId } : {}), scope });
    return { updated: true, ...(futureAppointmentId ? { futureAppointmentId } : {}), ...(request.body.notifyCreator ? { creatorNotificationQueued } : {}) };
  });

  app.get<{ Params: { id: string } }>("/api/modules/church-calendar/appointments/:id/extra-dates", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await context.pool.query<{ scope: CalendarScope; owner_user_id: string | null }>(
      `SELECT calendar.scope,calendar.owner_user_id FROM church_calendar_appointments appointment JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL`, [request.params.id, departmentId]);
    const calendar = result.rows[0];
    if (!calendar) return responseError(reply, 404, "The appointment was not found.");
    if (!canManageCalendar(request, calendar.scope, calendar.owner_user_id)) return responseError(reply, 403, "You do not have permission to view extra dates for this appointment.");
    const dates = await context.pool.query<{ startsAt: string; endsAt: string }>(
      `SELECT to_char(starts_at,'YYYY-MM-DD\"T\"HH24:MI:SS') AS "startsAt",to_char(ends_at,'YYYY-MM-DD\"T\"HH24:MI:SS') AS "endsAt" FROM church_calendar_extra_dates WHERE appointment_id=$1 ORDER BY starts_at LIMIT 501`, [request.params.id]);
    return dates.rows;
  });

  app.post<{ Params: { id: string }; Body: { startsAt: string; endsAt: string } }>("/api/modules/church-calendar/appointments/:id/extra-dates", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    body: { type: "object", additionalProperties: false, required: ["startsAt", "endsAt"], properties: { startsAt: { type: "string", minLength: 16, maxLength: 25 }, endsAt: { type: "string", minLength: 16, maxLength: 25 } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await context.pool.query<{ scope: CalendarScope; owner_user_id: string | null; time_zone: string; all_day: boolean }>(
      `SELECT calendar.scope,calendar.owner_user_id,COALESCE(appointment.time_zone,department.time_zone) AS time_zone,appointment.all_day
         FROM church_calendar_appointments appointment JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id
         JOIN departments department ON department.id=appointment.department_id
        WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL`, [request.params.id, departmentId]);
    const calendar = result.rows[0];
    if (!calendar) return responseError(reply, 404, "The appointment was not found.");
    if (!canManageCalendar(request, calendar.scope, calendar.owner_user_id)) return responseError(reply, 403, "You do not have permission to edit this appointment.");
    const startsAt = cleanLocalDateTime(request.body.startsAt);
    const endsAt = cleanLocalDateTime(request.body.endsAt);
    if (!startsAt || !endsAt || endsAt < startsAt) return responseError(reply, 400, "Choose valid start and end times.");
    if (!validAppointmentTimes({ startsAt, endsAt, allDay: calendar.all_day }, canonicalTimeZone(calendar.time_zone))) return responseError(reply, 400, invalidAppointmentTime);
    const saved = await context.pool.query(
      `INSERT INTO church_calendar_extra_dates(appointment_id,starts_at,ends_at,created_by)
       SELECT id,$2::timestamp,$3::timestamp,$4 FROM church_calendar_appointments
        WHERE id=$1 AND department_id=$5 AND archived_at IS NULL FOR UPDATE
       ON CONFLICT(appointment_id,starts_at) DO UPDATE SET ends_at=EXCLUDED.ends_at`, [request.params.id, startsAt, endsAt, userId(request), departmentId],
    );
    if (!saved.rowCount) return responseError(reply, 404, "The appointment was not found.");
    context.realtime.publish("module:church-calendar:changed", departmentId, { action: "extra-date-added", appointmentId: request.params.id });
    return reply.code(201).send({ added: true });
  });

  app.delete<{ Params: { id: string }; Querystring: { startsAt: string } }>("/api/modules/church-calendar/appointments/:id/extra-dates", { schema: {
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
    querystring: { type: "object", additionalProperties: false, required: ["startsAt"], properties: { startsAt: { type: "string", minLength: 16, maxLength: 25 } } },
  } }, async (request, reply) => {
    if (!context.pool || !context.isDatabaseReady()) return unavailable(reply);
    if (!context.validateMutation(request, reply)) return reply;
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return reply;
    const result = await context.pool.query<{ scope: CalendarScope; owner_user_id: string | null }>(
      `SELECT calendar.scope,calendar.owner_user_id FROM church_calendar_appointments appointment JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL`, [request.params.id, departmentId]);
    const calendar = result.rows[0];
    if (!calendar) return responseError(reply, 404, "The appointment was not found.");
    if (!canManageCalendar(request, calendar.scope, calendar.owner_user_id)) return responseError(reply, 403, "You do not have permission to edit extra dates for this appointment.");
    const startsAt = cleanLocalDateTime(request.query.startsAt);
    if (!startsAt) return responseError(reply, 400, "Choose a valid extra-date start time.");
    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return responseError(reply, 423, "This location is read-only.");
      }
      const { rows: [locked] } = await client.query<{ starts_at: string; recurrence: Recurrence | null }>(
        `SELECT to_char(starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,recurrence
           FROM church_calendar_appointments WHERE id=$1 AND department_id=$2 AND archived_at IS NULL FOR UPDATE`,
        [request.params.id, departmentId],
      );
      if (!locked) {
        await client.query("ROLLBACK");
        return responseError(reply, 404, "The appointment was not found.");
      }
      const activeReservation = await client.query(
        `SELECT 1 FROM church_calendar_resource_links link JOIN resource_bookings booking
            ON booking.id=link.resource_booking_id AND booking.department_id=$3
          WHERE link.appointment_id=$1 AND link.occurrence_start=$2::timestamp
            AND booking.status IN ('requested','approved') AND booking.ends_at>now() LIMIT 1`,
        [request.params.id, startsAt, departmentId],
      );
      if (activeReservation.rowCount) {
        await client.query("ROLLBACK");
        return responseError(reply, 409, "Open this extra occurrence in Calendar to review its reservations before removal.");
      }
      const deleted = await client.query(
        `WITH appointment AS (
           SELECT id FROM church_calendar_appointments WHERE id=$1 AND department_id=$3 AND archived_at IS NULL FOR UPDATE
         ) DELETE FROM church_calendar_extra_dates extra USING appointment
             WHERE extra.appointment_id=appointment.id AND extra.starts_at=$2::timestamp`, [request.params.id, startsAt, departmentId],
      );
      if (!deleted.rowCount) {
        await client.query("ROLLBACK");
        return responseError(reply, 404, "The extra date was not found.");
      }
      await client.query(
        `DELETE FROM church_calendar_appointment_exceptions exception WHERE appointment_id=$1 AND original_start=$2::timestamp
          AND NOT (exception.cancelled AND EXISTS (SELECT 1 FROM church_calendar_resource_links link
            WHERE link.appointment_id=exception.appointment_id AND link.occurrence_start=exception.original_start))`,
        [request.params.id, startsAt],
      );
      if (!calendarOccurrenceExists(locked, startsAt)) await client.query(
        `INSERT INTO church_calendar_appointment_exceptions(appointment_id,original_start,cancelled,overrides,updated_by)
         SELECT $1,$2::timestamp,true,'{}',$3 WHERE EXISTS (SELECT 1 FROM church_calendar_resource_links
           WHERE appointment_id=$1 AND occurrence_start=$2::timestamp)
         ON CONFLICT(appointment_id,original_start) DO NOTHING`,
        [request.params.id, startsAt, userId(request)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    context.realtime.publish("module:church-calendar:changed", departmentId, { action: "extra-date-removed", appointmentId: request.params.id });
    return { deleted: true };
  });
}
