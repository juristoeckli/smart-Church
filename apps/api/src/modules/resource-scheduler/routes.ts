import { recordPendingResourceBookingRequest, recordResourceBookingDecision, resourceBookingReviewers } from "../../resource-booking-notices.js";
import { registerResourceCalendarSubscriptions } from "./booking-calendar-subscriptions.js";
import { registerMyResourceBookings } from "./my-resource-bookings.js";
import { resourceBookedDayReport } from "./booked-day-report.js";
import { canBookForOthers, canViewResource, isResourceBookingManager as isManager, lockResourceBookingPolicy, resourceCalendarRequired, resourceManagerRequired } from "../../resource-booking-policy.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isServerModuleEnabled, type ModuleServerContext } from "../module-sdk.js";
import type { PoolClient } from "pg";
import { calendarBookingWindow, calendarOccurrenceExists, cleanLocalDateTime, localDateTime, wallDate, type Recurrence } from "../../calendar-occurrences.js";
import { canonicalTimeZone } from "../../calendar-time.js";

type Frequency = "once" | "daily" | "weekly" | "monthly" | "yearly";
type RepeatRule = { frequency: Frequency; interval?: number; endsOn?: string; count?: number; weekdays?: number[] };
type SeriesInput = {
  resourceId: string; purpose: string; subtitle?: string; description?: string; startsAt: string; endsAt: string; quantity?: number;
  leadInMinutes?: number; cleanupMinutes?: number; recurrence?: RepeatRule;
  allDayDate?: string;
  beneficiaryContactId?: string;
  extraDates?: string[]; excludedDates?: string[]; linkedAppointmentId?: string | null; linkedOccurrenceStartAt?: string;
};
type ResourceSelection = { resourceId: string; quantity: number; leadInMinutes: number; cleanupMinutes: number };
type OccurrenceResourceRequest = {
  linkedAppointmentId: string; linkedOccurrenceStartAt: string; purpose: string;
  startsAt: string; endsAt: string; resources: ResourceSelection[];
};
type FutureEditInput = { fromDate: string; purpose: string; subtitle?: string; description?: string; startsAt: string; endsAt: string; quantity: number; leadInMinutes: number; cleanupMinutes: number; recurrence: RepeatRule };

// Match the shared-calendar management policy. These grants also allow
// reading group calendars. Resource management by itself is insufficient.
function sharedCalendarLinkAccess(request: FastifyRequest) {
  const permissions = request.activeDepartmentPermissions ?? [];
  const shared = request.activeDepartmentRole === "site_admin"
    || (request.activeDepartmentModulePermissions?.["church-calendar"] ?? []).includes("manage")
    || permissions.includes("events_manage");
  return { community: shared, group: shared || permissions.includes("groups_manage") };
}

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
const DAY_MS = 86_400_000;
function partsInTimeZone(value: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour) % 24, minute: Number(values.minute), second: Number(values.second) };
}
function localDate(parts: Pick<ZonedParts, "year" | "month" | "day">) {
  return `${String(parts.year).padStart(4,"0")}-${String(parts.month).padStart(2,"0")}-${String(parts.day).padStart(2,"0")}`;
}
function occurrenceDateKey(value: Date, timeZone: string | null | undefined) {
  return timeZone ? localDate(partsInTimeZone(value, timeZone)) : value.toISOString().slice(0,10);
}
function occurrenceAtDate(startsAt: Date, endsAt: Date, date: string, timeZone: string | null | undefined) {
  const target = new Date(`${date}T00:00:00Z`);
  if (!timeZone) {
    const start = new Date(startsAt); start.setUTCFullYear(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
    return { startsAt: start, endsAt: new Date(start.getTime() + endsAt.getTime() - startsAt.getTime()) };
  }
  const startParts = partsInTimeZone(startsAt, timeZone), endParts = partsInTimeZone(endsAt, timeZone);
  const startDay = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
  const endDay = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
  const targetDay = target.getTime();
  const dayOffset = Math.round((endDay - startDay) / DAY_MS);
  const start = localDateTimeToUtc({ year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate(), hour: startParts.hour, minute: startParts.minute, second: startParts.second }, timeZone);
  const targetEnd = new Date(targetDay + dayOffset * DAY_MS);
  const end = localDateTimeToUtc({ year: targetEnd.getUTCFullYear(), month: targetEnd.getUTCMonth() + 1, day: targetEnd.getUTCDate(), hour: endParts.hour, minute: endParts.minute, second: endParts.second }, timeZone);
  return { startsAt: start, endsAt: end };
}
function isValidTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0)); return true; }
  catch { return false; }
}
function localDateTimeToUtc(parts: ZonedParts, timeZone: string) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const representedAt = (instant: number) => {
    const fields = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour) % 24, Number(fields.minute), Number(fields.second));
  };
  const offsets = new Set<number>();
  for (const delta of [-36,-24,-12,0,12,24,36]) {
    const instant = target + delta * 3_600_000;
    offsets.add(representedAt(instant) - instant);
  }
  const exact: number[] = [];
  const shifted: Array<{ instant: number; distance: number }> = [];
  for (const offset of offsets) {
    const instant = target - offset;
    const represented = representedAt(instant);
    if (represented === target) exact.push(instant);
    else if (represented > target && new Date(represented).toISOString().slice(0,10) === localDate(parts)) shifted.push({ instant, distance: represented - target });
  }
  // Fall-back ambiguity uses the first occurrence. Spring-forward gaps shift
  // forward by the size of the gap, preserving minutes (02:30 becomes 03:30).
  const chosen = exact.length ? Math.min(...exact) : shifted.sort((a,b)=>a.distance-b.distance)[0]?.instant;
  if (chosen === undefined) throw new Error(`Could not resolve local time in ${timeZone}.`);
  return new Date(chosen);
}
function fullDayBounds(date: string, timeZone: string) {
  const day = new Date(`${date}T00:00:00Z`);
  const midnight = () => localDateTimeToUtc({
    year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: 0, minute: 0, second: 0,
  }, timeZone);
  const startsAt = midnight();
  day.setUTCDate(day.getUTCDate() + 1);
  return { startsAt, endsAt: midnight() };
}

function seriesDates(startsAt: Date, endsAt: Date, rule: RepeatRule, extras: string[], excluded: string[], timeZone: string | null = null) {
  if (timeZone) return seriesDatesInTimeZone(startsAt, endsAt, rule, extras, excluded, timeZone);
  const interval = Math.max(1, Math.min(366, Math.floor(Number(rule.interval) || 1)));
  const until = rule.endsOn ? new Date(`${rule.endsOn}T23:59:59.999Z`) : new Date(startsAt.getTime() + 366 * 86_400_000);
  const last = new Date(Math.min(until.getTime(), startsAt.getTime() + 366 * 86_400_000));
  const duration = endsAt.getTime() - startsAt.getTime();
  const occurrences: Date[] = [];
  const excludedSet = new Set(excluded);
  const dayStart = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  const startDay = dayStart(startsAt);
  const weekdays = rule.weekdays?.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) ?? [];
  if (rule.frequency === "once") occurrences.push(new Date(startsAt));
  else {
    for (let cursor = startDay, index = 0; cursor <= last.getTime() && occurrences.length < 500; cursor += 86_400_000) {
      const date = new Date(cursor);
      const deltaDays = Math.round((cursor - startDay) / 86_400_000);
      const deltaWeeks = Math.floor(deltaDays / 7);
      const deltaMonths = (date.getUTCFullYear() - startsAt.getUTCFullYear()) * 12 + date.getUTCMonth() - startsAt.getUTCMonth();
      const match = rule.frequency === "daily" ? deltaDays % interval === 0
        : rule.frequency === "weekly" ? deltaWeeks % interval === 0 && (weekdays.length ? weekdays.includes(date.getUTCDay()) : date.getUTCDay() === startsAt.getUTCDay())
        : rule.frequency === "monthly" ? deltaMonths >= 0 && deltaMonths % interval === 0 && date.getUTCDate() === startsAt.getUTCDate()
        : rule.frequency === "yearly" ? date.getUTCMonth() === startsAt.getUTCMonth() && date.getUTCDate() === startsAt.getUTCDate() && (date.getUTCFullYear() - startsAt.getUTCFullYear()) % interval === 0
        : false;
      if (!match) continue;
      index += 1;
      if (rule.count && index > rule.count) break;
      const occurrence = new Date(date);
      occurrence.setUTCHours(startsAt.getUTCHours(), startsAt.getUTCMinutes(), startsAt.getUTCSeconds(), 0);
      if (occurrence >= startsAt && occurrence <= last) occurrences.push(occurrence);
    }
  }
  for (const day of extras) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const date = new Date(`${day}T${String(startsAt.toISOString()).slice(11, 23)}Z`);
    if (Number.isFinite(date.getTime()) && date >= startsAt && date <= last) occurrences.push(date);
  }
  const unique = new Map<string, Date>();
  for (const start of occurrences) {
    const key = start.toISOString();
    if (!excludedSet.has(key.slice(0, 10))) unique.set(key, start);
  }
  return [...unique.values()].sort((a, b) => a.getTime() - b.getTime()).slice(0, 500).map((start) => ({ startsAt: start, endsAt: new Date(start.getTime() + duration), localDate: start.toISOString().slice(0,10) }));
}

function seriesDatesInTimeZone(startsAt: Date, endsAt: Date, rule: RepeatRule, extras: string[], excluded: string[], timeZone: string, allDay = false) {
  const startParts = partsInTimeZone(startsAt, timeZone);
  const endParts = partsInTimeZone(endsAt, timeZone);
  const startDay = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
  const endDayOffset = Math.round((Date.UTC(endParts.year, endParts.month - 1, endParts.day) - startDay) / DAY_MS);
  const until = rule.endsOn ? new Date(`${rule.endsOn}T00:00:00Z`) : new Date(startDay + 366 * DAY_MS);
  const lastDay = Math.min(until.getTime(), startDay + 366 * DAY_MS);
  const occurrences = new Map<string,{ startsAt: Date; endsAt: Date; localDate: string }>();
  const excludedSet = new Set(excluded);
  const interval = Math.max(1, Math.min(366, Math.floor(Number(rule.interval) || 1)));
  const weekdays = rule.weekdays?.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) ?? [];
  if (rule.frequency === "once") {
    const day = localDate(startParts);
    occurrences.set(day, { startsAt: new Date(startsAt), endsAt: new Date(endsAt), localDate: day });
  } else {
    let count = 0;
    for (let cursor = startDay, deltaDays = 0; cursor <= lastDay && occurrences.size < 500; cursor += DAY_MS, deltaDays++) {
      const date = new Date(cursor);
      const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1, dayOfMonth = date.getUTCDate();
      const localDay = localDate({ year, month, day: dayOfMonth });
      const deltaWeeks = Math.floor(deltaDays / 7);
      const deltaMonths = (year - startParts.year) * 12 + month - startParts.month;
      const match = rule.frequency === "daily" ? deltaDays % interval === 0
        : rule.frequency === "weekly" ? deltaWeeks % interval === 0 && (weekdays.length ? weekdays.includes(date.getUTCDay()) : date.getUTCDay() === new Date(startDay).getUTCDay())
        : rule.frequency === "monthly" ? deltaMonths >= 0 && deltaMonths % interval === 0 && dayOfMonth === startParts.day
        : rule.frequency === "yearly" ? month === startParts.month && dayOfMonth === startParts.day && (year - startParts.year) % interval === 0
        : false;
      if (!match) continue;
      count++;
      if (rule.count && count > rule.count) break;
      if (excludedSet.has(localDay)) continue;
      if (allDay) {
        const window = fullDayBounds(localDay, timeZone);
        if (window.endsAt > window.startsAt) occurrences.set(localDay, { ...window, localDate: localDay });
        continue;
      }
      const occurrenceStart = localDay === localDate(startParts)
        ? new Date(startsAt)
        : localDateTimeToUtc({ year, month, day: dayOfMonth, hour: startParts.hour, minute: startParts.minute, second: startParts.second }, timeZone);
      if (occurrenceStart < startsAt) continue;
      const endDate = new Date(cursor + endDayOffset * DAY_MS);
      const occurrenceEnd = localDay === localDate(startParts)
        ? new Date(endsAt)
        : localDateTimeToUtc({ year: endDate.getUTCFullYear(), month: endDate.getUTCMonth() + 1, day: endDate.getUTCDate(), hour: endParts.hour, minute: endParts.minute, second: endParts.second }, timeZone);
      if (occurrenceStart.getTime() < lastDay + DAY_MS && occurrenceEnd > occurrenceStart) occurrences.set(localDay, { startsAt: occurrenceStart, endsAt: occurrenceEnd, localDate: localDay });
    }
  }
  for (const day of extras) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || excludedSet.has(day)) continue;
    const cursor = new Date(`${day}T00:00:00Z`).getTime();
    if (!Number.isFinite(cursor) || cursor < startDay || cursor > lastDay) continue;
    if (allDay) {
      const window = fullDayBounds(day, timeZone);
      if (window.endsAt > window.startsAt) occurrences.set(day, { ...window, localDate: day });
      continue;
    }
    const date = new Date(cursor);
    const dateParts = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    const start = day === localDate(startParts) ? new Date(startsAt) : localDateTimeToUtc({ ...dateParts, hour: startParts.hour, minute: startParts.minute, second: startParts.second }, timeZone);
    const endDate = new Date(cursor + endDayOffset * DAY_MS);
    const end = day === localDate(startParts) ? new Date(endsAt) : localDateTimeToUtc({ year: endDate.getUTCFullYear(), month: endDate.getUTCMonth() + 1, day: endDate.getUTCDate(), hour: endParts.hour, minute: endParts.minute, second: endParts.second }, timeZone);
    if (end > start) occurrences.set(day, { startsAt: start, endsAt: end, localDate: day });
  }
  return [...occurrences.values()].sort((a,b)=>a.startsAt.getTime()-b.startsAt.getTime()).slice(0,500);
}

function isoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function calendarLinkingAvailable(client: Pick<PoolClient, "query">, departmentId: string, occurrence: boolean) {
  if (!isServerModuleEnabled("church-calendar")) return false;
  const result = await client.query<{ available: boolean }>(
    `SELECT 'church-calendar'=ANY(enabled_modules)
       AND to_regclass('public.church_calendar_appointments') IS NOT NULL
       AND to_regclass('public.church_calendar_calendars') IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.church_calendar_resource_links')
           AND attname='occurrence_start' AND NOT attisdropped
       )
       AND (NOT $1::boolean OR (to_regclass('public.church_calendar_appointment_exceptions') IS NOT NULL
           AND to_regclass('public.church_calendar_extra_dates') IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.church_calendar_appointments')
               AND attname='time_zone' AND NOT attisdropped
           ))) AS available
       FROM departments WHERE id=$2`, [occurrence, departmentId],
  );
  return Boolean(result.rows[0]?.available);
}

async function insertBookingSeries(client: PoolClient, options: ResourceSelection & {
  departmentId: string; userId: string; purpose: string; subtitle?: string; description?: string; startsAt: Date; endsAt: Date; timeZone: string;
  allDayDate?: string;
  beneficiaryContactId?: string;
  repeat: RepeatRule; extraDates: string[]; excludedDates: string[];
  instances: { startsAt: Date; endsAt: Date; localDate: string }[];
  status: "requested" | "approved"; appointmentId: string | null; occurrenceStart: string | null;
}) {
  const {
    departmentId, resourceId, userId, purpose, subtitle = "", description = "", startsAt, endsAt, timeZone, repeat, extraDates, excludedDates,
    instances, quantity, leadInMinutes, cleanupMinutes, status, appointmentId, occurrenceStart, allDayDate, beneficiaryContactId,
  } = options;
  const seriesId = randomUUID();
  const bookingIds: string[] = [];
  await client.query(`INSERT INTO resource_booking_series(id,department_id,resource_id,requested_by,purpose,starts_at,ends_at,time_zone,recurrence,quantity,lead_in_minutes,cleanup_minutes,initial_status,linked_appointment_id,all_day_date,subtitle,description,beneficiary_contact_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15::date,$16,$17,$18)`, [seriesId, departmentId, resourceId, userId, purpose, startsAt, endsAt, timeZone, JSON.stringify(repeat), quantity, leadInMinutes, cleanupMinutes, status, occurrenceStart ? null : appointmentId, allDayDate ?? null, subtitle, description, beneficiaryContactId ?? null]);
  for (const day of new Set(extraDates)) await client.query("INSERT INTO resource_booking_series_dates(series_id,occurrence_date,date_type,created_by) VALUES($1,$2,'extra',$3) ON CONFLICT DO NOTHING", [seriesId, day, userId]);
  for (const day of new Set(excludedDates)) await client.query("INSERT INTO resource_booking_series_dates(series_id,occurrence_date,date_type,created_by) VALUES($1,$2,'excluded',$3) ON CONFLICT DO NOTHING", [seriesId, day, userId]);
  for (const occurrence of instances) {
    const bookingId = randomUUID();
    bookingIds.push(bookingId);
    await client.query(`INSERT INTO resource_bookings(id,department_id,resource_id,requested_by,purpose,starts_at,ends_at,status,quantity,lead_in_minutes,cleanup_minutes,subtitle,description,beneficiary_contact_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [bookingId, departmentId, resourceId, userId, purpose, occurrence.startsAt, occurrence.endsAt, status, quantity, leadInMinutes, cleanupMinutes, subtitle, description, beneficiaryContactId ?? null]);
    await client.query("INSERT INTO resource_booking_series_occurrences(id,department_id,series_id,resource_booking_id,occurrence_starts_at,is_extra_date) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), departmentId, seriesId, bookingId, occurrence.startsAt, extraDates.includes(occurrence.localDate)]);
    if (appointmentId) {
      await client.query("INSERT INTO church_calendar_resource_links(appointment_id,resource_booking_id,created_by,occurrence_start) VALUES($1,$2,$3,$4::timestamp) ON CONFLICT DO NOTHING", [appointmentId, bookingId, userId, occurrenceStart]);
    }
  }
  await client.query("INSERT INTO resource_scheduler_audit(id,department_id,actor_user_id,action,series_id,details) VALUES($1,$2,$3,'series_created',$4,$5::jsonb)", [randomUUID(), departmentId, userId, seriesId, JSON.stringify({ occurrenceCount: instances.length, status, quantity, leadInMinutes, cleanupMinutes, ...(allDayDate ? { allDayDate } : {}) })]);
  return { seriesId, bookingIds };
}

export function registerModuleRoutes(app: FastifyInstance, context: ModuleServerContext) {
  const unavailable = (reply: FastifyReply) => reply.code(503).send({ error: "Resource scheduling is unavailable." });
  async function location(request: FastifyRequest, reply: FastifyReply, requireManager = false) {
    if (!context.pool || !context.isDatabaseReady()) { unavailable(reply); return null; }
    const departmentId = await context.resolveDepartmentId(request, reply);
    if (!departmentId) return null;
    if (requireManager && !isManager(request)) { reply.code(403).send({ error: "Resource management access is required." }); return null; }
    return departmentId;
  }
  async function lockLinkableAppointment(client: { query: (sql: string, values?: unknown[]) => Promise<any> }, request: FastifyRequest, departmentId: string, appointmentId: string) {
    const access = sharedCalendarLinkAccess(request);
    const result = await client.query(
      `SELECT appointment.id FROM church_calendar_appointments appointment
        JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
        WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL
          AND calendar.archived_at IS NULL
          AND ((calendar.scope='community' AND $3::boolean) OR (calendar.scope='group' AND $4::boolean))
        FOR SHARE OF appointment,calendar`, [appointmentId, departmentId, access.community, access.group]);
    return Boolean(result.rowCount);
  }

  async function lockOccurrenceWindow(client: PoolClient, request: FastifyRequest, departmentId: string, appointmentId: string, original: string, locationTimeZone: string) {
    const access = sharedCalendarLinkAccess(request);
    const result = await client.query<{ starts_at: string; ends_at: string; recurrence: Recurrence | null; time_zone: string | null; all_day: boolean }>(
      `SELECT to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
              to_char(appointment.ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at,appointment.recurrence,appointment.time_zone,appointment.all_day
         FROM church_calendar_appointments appointment
         JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
        WHERE appointment.id=$1 AND appointment.department_id=$2 AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL
          AND ((calendar.scope='community' AND $3::boolean) OR (calendar.scope='group' AND $4::boolean))
        FOR UPDATE OF appointment FOR SHARE OF calendar`, [appointmentId, departmentId, access.community, access.group],
    );
    const appointment = result.rows[0];
    if (!appointment) return null;
    const exception = (await client.query<{ cancelled: boolean; overrides: Record<string, unknown> }>(
      "SELECT cancelled,overrides FROM church_calendar_appointment_exceptions WHERE appointment_id=$1 AND original_start=$2::timestamp FOR SHARE", [appointmentId, original],
    )).rows[0];
    if (exception?.cancelled) return null;
    const extra = (await client.query<{ ends_at: string }>(
      `SELECT to_char(ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at FROM church_calendar_extra_dates
        WHERE appointment_id=$1 AND starts_at=$2::timestamp FOR SHARE`, [appointmentId, original],
    )).rows[0];
    if (!extra && !calendarOccurrenceExists(appointment, original)) return null;
    const overrides = exception?.overrides ?? {};
    const duration = wallDate(appointment.ends_at).getTime() - wallDate(appointment.starts_at).getTime();
    const startsAt = cleanLocalDateTime(overrides.startsAt) ?? original;
    const endsAt = cleanLocalDateTime(overrides.endsAt) ?? extra?.ends_at ?? localDateTime(new Date(wallDate(original).getTime() + duration));
    const timeZone = appointment.time_zone ?? canonicalTimeZone(locationTimeZone) ?? "UTC";
    return calendarBookingWindow(startsAt, endsAt, (overrides.allDay ?? appointment.all_day) === true, timeZone);
  }

  async function calculateFutureEdit(departmentId: string, seriesId: string, input: FutureEditInput, queryable: { query: (sql: string, values?: unknown[]) => Promise<any> }, apply = false) {
    const seriesResult = await queryable.query("SELECT * FROM resource_booking_series WHERE id=$1 AND department_id=$2 AND archived_at IS NULL", [seriesId, departmentId]);
    const series = seriesResult.rows[0];
    if (!series) return { error: "Booking series not found in this location." } as const;
    const startsAt = new Date(input.startsAt); const endsAt = new Date(input.endsAt);
    if (!isoDate(input.fromDate) || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) return { error: "Choose a valid date range and start/end time." } as const;
    if (occurrenceDateKey(startsAt, series.time_zone ?? null) !== input.fromDate) return { error: "The new series start date must match the selected future edit date." } as const;
    if (startsAt.getTime() < Date.now() - 60_000 || startsAt.getTime() > Date.now() + 366 * 86_400_000) return { error: "Choose an edit date and time in the next twelve months." } as const;
    if (input.recurrence.endsOn && (!isoDate(input.recurrence.endsOn) || input.recurrence.endsOn < input.fromDate)) return { error: "Choose a valid repeat end date on or after the edit date." } as const;
    const resourceResult = await queryable.query("SELECT resource.calendar_required,resource.manager_booking_only,resource.visibility_group_id,COALESCE(settings.total_units,1)::int AS total_units FROM bookable_resources resource LEFT JOIN resource_scheduler_settings settings ON settings.department_id=resource.department_id AND settings.resource_id=resource.id WHERE resource.id=$1 AND resource.department_id=$2 AND resource.active=true", [series.resource_id, departmentId]);
    if (!resourceResult.rowCount) return { error: "The resource is no longer available in this location." } as const;
    if (input.quantity < 1 || input.quantity > Number(resourceResult.rows[0].total_units)) return { error: "Quantity exceeds this resource's available units." } as const;
    const dates = await queryable.query("SELECT occurrence_date::text AS date,date_type FROM resource_booking_series_dates WHERE series_id=$1", [seriesId]);
    const extras = dates.rows.filter((row: { date_type: string }) => row.date_type === "extra").map((row: { date: string }) => row.date);
    const excluded = dates.rows.filter((row: { date_type: string }) => row.date_type === "excluded").map((row: { date: string }) => row.date);
    let proposed: ReturnType<typeof seriesDates>;
    if (series.all_day_date) {
      try {
        const window = fullDayBounds(input.fromDate, series.time_zone);
        if (+window.startsAt !== +startsAt || +window.endsAt !== +endsAt) {
          return { error: "Full-day bookings must match the full calendar day in the series time zone." } as const;
        }
        proposed = seriesDatesInTimeZone(startsAt, endsAt, input.recurrence, extras, excluded, series.time_zone, true);
      } catch {
        return { error: "A full-day booking date could not be resolved in the series time zone." } as const;
      }
    } else {
      proposed = seriesDates(startsAt, endsAt, input.recurrence, extras, excluded, series.time_zone ?? null);
    }
    proposed = proposed.filter((item) => item.localDate >= input.fromDate);
    if (!proposed.length) return { error: "This repeat rule has no future occurrences from the selected date." } as const;
    const current = await queryable.query(`SELECT occurrence.resource_booking_id AS id,occurrence.occurrence_starts_at AS "occurrenceStartsAt",occurrence.is_extra_date AS "isExtraDate",booking.status,
        to_char((occurrence.occurrence_starts_at AT TIME ZONE COALESCE(series.time_zone,'UTC'))::date,'YYYY-MM-DD') AS "occurrenceDate",
        EXISTS(SELECT 1 FROM resource_booking_series_occurrence_overrides override WHERE override.series_id=occurrence.series_id AND override.occurrence_date=(occurrence.occurrence_starts_at AT TIME ZONE COALESCE(series.time_zone,'UTC'))::date) AS "hasOccurrenceOverride"
      FROM resource_booking_series_occurrences occurrence JOIN resource_booking_series series ON series.id=occurrence.series_id AND series.department_id=occurrence.department_id
      JOIN resource_bookings booking ON booking.id=occurrence.resource_booking_id AND booking.department_id=occurrence.department_id
      WHERE occurrence.department_id=$1 AND occurrence.series_id=$2 AND booking.starts_at>=now()
        AND (occurrence.occurrence_starts_at AT TIME ZONE COALESCE(series.time_zone,'UTC'))::date >= $3::date ORDER BY occurrence.occurrence_starts_at${apply && series.all_day_date ? " FOR UPDATE OF booking" : ""}`, [departmentId, seriesId, input.fromDate]);
    const approved = current.rows.filter((row: { status: string }) => row.status === "approved");
    const requested = current.rows.filter((row: { status: string }) => row.status === "requested");
    const requestedDates = new Set(requested.map((row: { occurrenceDate: string }) => row.occurrenceDate));
    const retained = proposed.filter((item) => requestedDates.has(item.localDate)).length;
    return { series, startsAt, endsAt, proposed, approvedCount: approved.length, current, requested, addedCount: proposed.length - retained, updatedCount: retained, cancelledCount: requested.length - retained, resourceUnits: Number(resourceResult.rows[0].total_units), calendarRequired: resourceResult.rows[0].calendar_required === true, managerBookingOnly: resourceResult.rows[0].manager_booking_only === true, visibilityGroupId: resourceResult.rows[0].visibility_group_id as string | null };
  }

  const resourceCategories = ["room", "vehicle", "equipment", "other"] as const;

  app.get<{ Querystring: { q?: string } }>("/api/modules/resource-scheduler/booking-beneficiaries", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: { q: { type: "string", maxLength: 80 } } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    if (!canBookForOthers(request)) return reply.code(403).send({ error: "Resource management and private People access are required." });
    reply.header("Cache-Control", "private, no-store");
    const query = request.query.q?.trim() ?? "";
    if (query.length < 2) return [];
    return (await context.pool!.query<{ id: string; name: string }>(
      `SELECT id,concat_ws(' ',first_name,last_name) AS name
         FROM contacts WHERE department_id=$1 AND archived_at IS NULL
          AND strpos(lower(concat_ws(' ',first_name,last_name)),lower($2))>0
        ORDER BY lower(last_name),lower(first_name),id LIMIT 30`,
      [departmentId, query],
    )).rows;
  });

  app.get<{ Querystring: { from?: string; to?: string; status?: string; resourceId?: string; markedOnly?: string; search?: string; category?: string } }>("/api/modules/resource-scheduler/bootstrap", async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    const from = request.query.from && /^\d{4}-\d{2}-\d{2}$/.test(request.query.from) ? request.query.from : new Date().toISOString().slice(0, 10);
    const to = request.query.to && /^\d{4}-\d{2}-\d{2}$/.test(request.query.to) ? request.query.to : new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const search = typeof request.query.search === "string" ? request.query.search.trim().slice(0, 100) : "";
    const category = request.query.category || null;
    if (category && !resourceCategories.some((value) => value === category)) return reply.code(400).send({ error: "Choose a valid resource type." });
    const canManage = isManager(request);
    const [department, resources, bookings, responsiblePeople, visibilityGroups] = await Promise.all([
      context.pool!.query<{ time_zone: string }>("SELECT time_zone FROM departments WHERE id=$1", [departmentId]),
      context.pool!.query(`SELECT resource.id,resource.name,resource.category,resource.location,resource.active,resource.requires_approval,resource.calendar_required AS "calendarRequired",resource.manager_booking_only AS "managerBookingOnly",
          CASE WHEN $2 THEN resource.responsible_user_id END AS "responsibleUserId",
          CASE WHEN $2 THEN resource.visibility_group_id END AS "visibilityGroupId",
          ($4::text='' OR (strpos(lower(resource.name),lower($4))>0 OR strpos(lower(resource.category),lower($4))>0 OR strpos(lower(resource.location),lower($4))>0)) AS "matchesSearch",
          EXISTS (SELECT 1 FROM resource_scheduler_marks mark WHERE mark.department_id=resource.department_id AND mark.resource_id=resource.id AND mark.user_id=$3) AS marked,
          COALESCE(settings.total_units,1) AS "totalUnits",COALESCE(settings.default_lead_in_minutes,0) AS "defaultLeadInMinutes",COALESCE(settings.default_cleanup_minutes,0) AS "defaultCleanupMinutes"
        FROM bookable_resources resource LEFT JOIN resource_scheduler_settings settings ON settings.resource_id=resource.id AND settings.department_id=resource.department_id
        WHERE resource.department_id=$1 AND ($2 OR resource.active=true)
          AND can_view_bookable_resource(resource.department_id,resource.visibility_group_id,$3,$2) ORDER BY resource.location,resource.category,resource.name`, [departmentId, isManager(request), request.authenticatedUser!.id, search]),
      context.pool!.query(`SELECT booking.id,booking.resource_id AS "resourceId",resource.name AS "resourceName",resource.location,
          booking.requested_by AS "requestedBy",requester.display_name AS "requesterName",booking.purpose,booking.subtitle,booking.description,
          CASE WHEN beneficiary.id IS NOT NULL THEN concat_ws(' ',beneficiary.first_name,beneficiary.last_name) END AS "beneficiaryName",
          booking.starts_at AS "startsAt",booking.ends_at AS "endsAt",booking.status,booking.quantity,
          booking.lead_in_minutes AS "leadInMinutes",booking.cleanup_minutes AS "cleanupMinutes",
          series.id AS "seriesId",series.recurrence,(series.linked_appointment_id IS NOT NULL) AS "hasLinkedAppointment",occurrence.is_extra_date AS "isExtraDate",
          CASE WHEN series.all_day_date IS NOT NULL AND day_override.all_day IS DISTINCT FROM FALSE THEN to_char((occurrence.occurrence_starts_at AT TIME ZONE series.time_zone)::date,'YYYY-MM-DD') END AS "allDayDate", (series.all_day_date IS NOT NULL) AS "seriesAllDay",series.time_zone AS "timeZone",to_char((occurrence.occurrence_starts_at AT TIME ZONE COALESCE(series.time_zone,'UTC'))::date,'YYYY-MM-DD') AS "occurrenceDate",
          EXISTS(SELECT 1 FROM resource_booking_series_occurrence_overrides override WHERE override.series_id=series.id AND override.occurrence_date=(occurrence.occurrence_starts_at AT TIME ZONE COALESCE(series.time_zone,'UTC'))::date) AS "hasOccurrenceOverride",
          (booking.requested_by=$6 OR $7) AS "canCancel",(series.id IS NOT NULL AND (series.all_day_date IS NULL OR series.recurrence->>'frequency' <> 'once') AND (booking.requested_by=$6 OR $7)) AS "canEditSeries",
          booking.created_at AS "createdAt",booking.updated_at AS "updatedAt"
        FROM resource_bookings booking JOIN bookable_resources resource ON resource.id=booking.resource_id AND resource.department_id=booking.department_id
        JOIN app_users requester ON requester.id=booking.requested_by
        LEFT JOIN contacts beneficiary ON $11::boolean AND beneficiary.id=booking.beneficiary_contact_id
          AND beneficiary.department_id=booking.department_id AND beneficiary.archived_at IS NULL
        LEFT JOIN resource_booking_series_occurrences occurrence ON occurrence.resource_booking_id=booking.id AND occurrence.department_id=booking.department_id
        LEFT JOIN resource_booking_series series ON series.id=occurrence.series_id AND series.department_id=booking.department_id
        LEFT JOIN resource_booking_series_occurrence_overrides day_override
          ON day_override.series_id=series.id AND day_override.resource_booking_id=booking.id
          AND day_override.occurrence_date=(occurrence.occurrence_starts_at AT TIME ZONE COALESCE(series.time_zone,'UTC'))::date
        WHERE booking.department_id=$1 AND booking.ends_at >= ($2::date::timestamptz - interval '1 day') AND booking.starts_at < ($3::date::timestamptz + interval '1 day')
          AND ($4::text IS NULL OR booking.status=$4) AND ($5::uuid IS NULL OR booking.resource_id=$5)
          AND ($10::text IS NULL OR resource.category=$10)
          AND (NOT $8::boolean OR EXISTS (SELECT 1 FROM resource_scheduler_marks mark WHERE mark.department_id=booking.department_id AND mark.resource_id=booking.resource_id AND mark.user_id=$6))
          AND ($7::boolean OR resource.active=true)
          AND (booking.requested_by=$6 OR can_view_bookable_resource(resource.department_id,resource.visibility_group_id,$6,$7))
          AND ($9::text='' OR (strpos(lower(resource.name),lower($9))>0 OR strpos(lower(resource.category),lower($9))>0 OR strpos(lower(resource.location),lower($9))>0) OR strpos(lower(booking.purpose),lower($9))>0 OR strpos(lower(booking.subtitle),lower($9))>0 OR strpos(lower(requester.display_name),lower($9))>0)
        ORDER BY booking.starts_at,resource.name,booking.id LIMIT 2000`, [departmentId, from, to, request.query.status && request.query.status !== "all" ? request.query.status : null, request.query.resourceId ?? null, request.authenticatedUser!.id, isManager(request), request.query.markedOnly === "true", search, category, canBookForOthers(request)]),
      canManage ? resourceBookingReviewers(context.pool!, departmentId) : Promise.resolve([]),
      canManage ? context.pool!.query<{ id: string; name: string }>(
        "SELECT id,name FROM church_groups groups WHERE department_id=$1 AND (to_jsonb(groups)->>'status')='active' ORDER BY lower(name),id", [departmentId],
      ).then((result) => result.rows) : Promise.resolve([]),
    ]);
    return { resources: resources.rows, bookings: bookings.rows, canManage, responsiblePeople, visibilityGroups, timeZone: department.rows[0]?.time_zone ?? "UTC", from, to, canBookForOthers: canBookForOthers(request) };
  });

  type BookedDayQuery = { from: string; through: string; resourceId?: string; markedOnly?: boolean; category?: string };
  app.get<{ Querystring: BookedDayQuery }>("/api/modules/resource-scheduler/booked-days", {
    schema: { querystring: { type: "object", additionalProperties: false, required: ["from", "through"], properties: {
      from: { type: "string", format: "date" }, through: { type: "string", format: "date" },
      resourceId: { type: "string", format: "uuid" }, markedOnly: { type: "boolean" },
      category: { type: "string", enum: resourceCategories },
    } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    const { from, through, resourceId, markedOnly, category } = request.query;
    if (!isoDate(from) || !isoDate(through) || from < "0001-01-01" || through >= "9999-12-31" || from > through) {
      return reply.code(400).send({ error: "Choose a valid start and end date." });
    }
    const calendarDays = (Date.parse(through) - Date.parse(from)) / 86_400_000 + 1;
    if (calendarDays > 548) return reply.code(400).send({ error: "Choose a range of up to 548 calendar days." });
    const department = await context.pool!.query<{ time_zone: string | null }>("SELECT time_zone FROM departments WHERE id=$1", [departmentId]);
    const timeZone = canonicalTimeZone(department.rows[0]?.time_zone) ?? "UTC";
    const report = await context.pool!.query(resourceBookedDayReport,
      [departmentId, isManager(request), request.authenticatedUser!.id, from, through, timeZone, resourceId ?? null, markedOnly ?? false, category ?? null]);
    return reply.header("Cache-Control", "private, no-store").send({ from, through, timeZone, calendarDays, resources: report.rows });
  });

  registerMyResourceBookings(app, context, location);
  registerResourceCalendarSubscriptions(app, context, location);

  app.get("/api/modules/resource-scheduler/home-bookings", async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    const canManage = isManager(request);
    const selectBookings = `SELECT booking.id,resource.name AS "resourceName",resource.location,booking.purpose,requester.display_name AS "requesterName",
        booking.starts_at AS "startsAt",booking.ends_at AS "endsAt"
      FROM resource_bookings booking JOIN bookable_resources resource
        ON resource.id=booking.resource_id AND resource.department_id=booking.department_id
      JOIN app_users requester ON requester.id=booking.requested_by
      WHERE booking.department_id=$1`;
    const [current, pending] = await Promise.all([
      context.pool!.query(`${selectBookings} AND booking.status='approved'
        AND booking.starts_at<=now() AND booking.ends_at>now()
        AND ($2::boolean OR (resource.active AND booking.requested_by=$3))
        ORDER BY booking.ends_at,booking.id LIMIT 6`, [departmentId, canManage, request.authenticatedUser!.id]),
      canManage ? context.pool!.query(`${selectBookings} AND booking.status='requested' AND booking.ends_at>now()
        ORDER BY booking.starts_at,booking.id LIMIT 6`, [departmentId]) : null,
    ]);
    return { current: current.rows, pending: pending?.rows ?? null };
  });

  app.put<{ Params: { resourceId: string }; Body: { marked: boolean } }>("/api/modules/resource-scheduler/resources/:resourceId/mark", {
    schema: {
      params: { type: "object", required: ["resourceId"], properties: { resourceId: { type: "string", format: "uuid" } } },
      body: { type: "object", required: ["marked"], additionalProperties: false, properties: { marked: { type: "boolean" } } },
    },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId || !context.validateMutation(request, reply)) return reply;
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This location is read-only on this installation." });
      }
      const resourceId = request.params.resourceId;
      const resource = await client.query("SELECT id FROM bookable_resources WHERE id=$1 AND department_id=$2 AND (active OR $3) AND can_view_bookable_resource(department_id,visibility_group_id,$4,$3) FOR SHARE", [resourceId, departmentId, isManager(request), request.authenticatedUser!.id]);
      if (!resource.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Resource not found in this location." });
      }
      const values = [departmentId, request.authenticatedUser!.id, resourceId];
      if (request.body.marked) {
        await client.query("INSERT INTO resource_scheduler_marks(department_id,user_id,resource_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", values);
      } else {
        await client.query("DELETE FROM resource_scheduler_marks WHERE department_id=$1 AND user_id=$2 AND resource_id=$3", values);
      }
      await client.query("COMMIT");
      return { marked: request.body.marked };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.put<{ Params: { resourceId: string }; Body: { totalUnits: number; defaultLeadInMinutes: number; defaultCleanupMinutes: number; calendarRequired?: boolean; responsibleUserId?: string | null; managerBookingOnly?: boolean; visibilityGroupId?: string | null } }>("/api/modules/resource-scheduler/resources/:resourceId/settings", {
    schema: { params: { type: "object", required: ["resourceId"], properties: { resourceId: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["totalUnits", "defaultLeadInMinutes", "defaultCleanupMinutes"], properties: { totalUnits: { type: "integer", minimum: 1, maximum: 10000 }, defaultLeadInMinutes: { type: "integer", minimum: 0, maximum: 10080 }, defaultCleanupMinutes: { type: "integer", minimum: 0, maximum: 10080 }, calendarRequired: { type: "boolean" }, managerBookingOnly: { type: "boolean" }, visibilityGroupId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] }, responsibleUserId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] } } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply, true);
    if (!departmentId) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      const resource = await lockResourceBookingPolicy(client, departmentId, request.params.resourceId);
      if (!resource) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Resource not found in this location." }); }
      const peak = await client.query<{ peak_units: string }>(`WITH active AS (
          SELECT starts_at-make_interval(mins=>lead_in_minutes) AS begins_at,ends_at+make_interval(mins=>cleanup_minutes) AS finishes_at,quantity
            FROM resource_bookings WHERE department_id=$1 AND resource_id=$2 AND status IN ('requested','approved')
        ), points AS (SELECT begins_at AS point_at FROM active UNION SELECT finishes_at FROM active)
        SELECT COALESCE(max((SELECT sum(quantity) FROM active WHERE begins_at<=points.point_at AND finishes_at>points.point_at)),0)::text AS peak_units FROM points`, [departmentId, request.params.resourceId]);
      if (Number(peak.rows[0]?.peak_units ?? 0) > request.body.totalUnits) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Available units cannot be lower than the units already reserved at the busiest time." }); }
      const result = await client.query(`INSERT INTO resource_scheduler_settings(department_id,resource_id,total_units,default_lead_in_minutes,default_cleanup_minutes)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(department_id,resource_id) DO UPDATE SET total_units=EXCLUDED.total_units,default_lead_in_minutes=EXCLUDED.default_lead_in_minutes,default_cleanup_minutes=EXCLUDED.default_cleanup_minutes,updated_at=now()
        RETURNING total_units AS "totalUnits",default_lead_in_minutes AS "defaultLeadInMinutes",default_cleanup_minutes AS "defaultCleanupMinutes"`, [departmentId, request.params.resourceId, request.body.totalUnits, request.body.defaultLeadInMinutes, request.body.defaultCleanupMinutes]);
      const calendarRequired = request.body.calendarRequired ?? resource.calendar_required;
      if (calendarRequired && !resource.calendar_required) {
        if (!await calendarLinkingAvailable(client, departmentId, true)) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Enable General Calendar before requiring an appointment for this resource." });
        }
      }
      const responsibleUserId = request.body.responsibleUserId === undefined
        ? resource.responsible_user_id : request.body.responsibleUserId?.toLowerCase() ?? null;
      if (responsibleUserId !== resource.responsible_user_id && responsibleUserId
          && !(await resourceBookingReviewers(client, departmentId, responsibleUserId)).length) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "Choose someone who can manage resource bookings in this location." });
      }
      const managerBookingOnly = request.body.managerBookingOnly ?? resource.manager_booking_only;
      const visibilityGroupId = request.body.visibilityGroupId === undefined
        ? resource.visibility_group_id : request.body.visibilityGroupId?.toLowerCase() ?? null;
      if (visibilityGroupId && visibilityGroupId !== resource.visibility_group_id) {
        const group = await client.query("SELECT id FROM church_groups groups WHERE id=$1 AND department_id=$2 AND (to_jsonb(groups)->>'status')='active' FOR SHARE",
          [visibilityGroupId, departmentId]);
        if (!group.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Choose an active group in this location." });
        }
      }
      if (calendarRequired !== resource.calendar_required || responsibleUserId !== resource.responsible_user_id
          || managerBookingOnly !== resource.manager_booking_only || visibilityGroupId !== resource.visibility_group_id) {
        await client.query("UPDATE bookable_resources SET calendar_required=$3,responsible_user_id=$4,manager_booking_only=$5,visibility_group_id=$6,updated_at=now() WHERE department_id=$1 AND id=$2",
          [departmentId, resource.id, calendarRequired, responsibleUserId, managerBookingOnly, visibilityGroupId]);
      }
      await client.query("COMMIT");
      context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
      return { ...result.rows[0], calendarRequired, responsibleUserId, managerBookingOnly, visibilityGroupId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  app.post<{ Body: { startsAt: string; endsAt: string; resources: ResourceSelection[] } }>("/api/modules/resource-scheduler/availability", {
    schema: { body: { type: "object", additionalProperties: false, required: ["startsAt", "endsAt", "resources"], properties: {
      startsAt: { type: "string", format: "date-time" },
      endsAt: { type: "string", format: "date-time" },
      resources: { type: "array", minItems: 1, maxItems: 20, items: {
        type: "object", additionalProperties: false, required: ["resourceId", "quantity", "leadInMinutes", "cleanupMinutes"], properties: {
          resourceId: { type: "string", format: "uuid" },
          quantity: { type: "integer", minimum: 1, maximum: 10000 },
          leadInMinutes: { type: "integer", minimum: 0, maximum: 10080 },
          cleanupMinutes: { type: "integer", minimum: 0, maximum: 10080 },
        },
      } },
    } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    const { startsAt, endsAt, resources } = request.body;
    const start = Date.parse(startsAt);
    const end = Date.parse(endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return reply.code(400).send({ error: "Choose a valid start and end time." });
    const ids = new Set(resources.map((resource) => resource.resourceId.toLowerCase()));
    if (ids.size !== resources.length) return reply.code(400).send({ error: "Select each resource once." });

    // Match the capacity trigger's buffered, half-open time windows. Only aggregate availability is exposed.
    const result = await context.pool!.query<{ resourceId: string; availableUnits: number; requestedUnits: number }>(
      `WITH proposed AS (
         SELECT draft."resourceId" AS resource_id,draft.quantity,
                $2::timestamptz-make_interval(mins=>draft."leadInMinutes") AS begins_at,
                $3::timestamptz+make_interval(mins=>draft."cleanupMinutes") AS finishes_at
           FROM jsonb_to_recordset($4::jsonb) AS draft("resourceId" uuid,quantity int,"leadInMinutes" int,"cleanupMinutes" int)
       )
       SELECT proposed.resource_id AS "resourceId",proposed.quantity AS "requestedUnits",
              greatest(COALESCE(settings.total_units,1)-usage.peak,0)::int AS "availableUnits"
         FROM proposed
         JOIN bookable_resources resource ON resource.id=proposed.resource_id AND resource.department_id=$1 AND resource.active
           AND can_view_bookable_resource(resource.department_id,resource.visibility_group_id,$5,$6)
         LEFT JOIN resource_scheduler_settings settings ON settings.resource_id=resource.id AND settings.department_id=resource.department_id
         CROSS JOIN LATERAL (
           WITH occupied AS (
             SELECT starts_at-make_interval(mins=>lead_in_minutes) AS begins_at,
                    ends_at+make_interval(mins=>cleanup_minutes) AS finishes_at,quantity
               FROM resource_bookings booking
              WHERE booking.department_id=$1 AND booking.resource_id=proposed.resource_id
                AND booking.status IN ('requested','approved')
                AND starts_at<proposed.finishes_at+make_interval(mins=>10080)
                AND ends_at>proposed.begins_at-make_interval(mins=>10080)
                AND starts_at-make_interval(mins=>lead_in_minutes)<proposed.finishes_at
                AND ends_at+make_interval(mins=>cleanup_minutes)>proposed.begins_at
           ), points AS (
             SELECT proposed.begins_at AS point_at
             UNION SELECT begins_at FROM occupied WHERE begins_at>=proposed.begins_at
           )
           SELECT COALESCE(max((SELECT COALESCE(sum(quantity),0) FROM occupied
                                WHERE begins_at<=points.point_at AND finishes_at>points.point_at)),0) AS peak
             FROM points
         ) AS usage`, [departmentId, startsAt, endsAt, JSON.stringify(resources), request.authenticatedUser!.id, isManager(request)],
    );
    if (result.rows.length !== ids.size) return reply.code(404).send({ error: "One of the selected resources is no longer available in this location." });
    return { resources: result.rows };
  });



  app.post<{ Body: OccurrenceResourceRequest }>("/api/modules/resource-scheduler/occurrence-bookings", {
    schema: { body: { type: "object", additionalProperties: false, required: ["linkedAppointmentId", "linkedOccurrenceStartAt", "purpose", "startsAt", "endsAt", "resources"], properties: {
      linkedAppointmentId: { type: "string", format: "uuid" },
      linkedOccurrenceStartAt: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$" },
      purpose: { type: "string", minLength: 1, maxLength: 240 },
      startsAt: { type: "string", format: "date-time" },
      endsAt: { type: "string", format: "date-time" },
      resources: { type: "array", minItems: 1, maxItems: 20, items: {
        type: "object", additionalProperties: false, required: ["resourceId", "quantity", "leadInMinutes", "cleanupMinutes"], properties: {
          resourceId: { type: "string", format: "uuid" },
          quantity: { type: "integer", minimum: 1, maximum: 10000 },
          leadInMinutes: { type: "integer", minimum: 0, maximum: 10080 },
          cleanupMinutes: { type: "integer", minimum: 0, maximum: 10080 },
        },
      } },
    } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply, true);
    if (!departmentId) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    const { linkedAppointmentId: appointmentId } = request.body;
    const occurrenceStart = cleanLocalDateTime(request.body.linkedOccurrenceStartAt);
    const purpose = request.body.purpose.trim();
    const startsAt = new Date(request.body.startsAt);
    const endsAt = new Date(request.body.endsAt);
    const now = Date.now();
    if (!purpose || !occurrenceStart || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      return reply.code(400).send({ error: "Choose a valid purpose and saved Calendar occurrence." });
    }
    if (startsAt.getTime() < now - 60_000 || startsAt.getTime() > now + 366 * 86_400_000) {
      return reply.code(400).send({ error: "Choose a start within the next twelve months." });
    }
    const selections = request.body.resources.map((resource) => ({ ...resource, resourceId: resource.resourceId.toLowerCase() }));
    if (new Set(selections.map((resource) => resource.resourceId)).size !== selections.length) {
      return reply.code(400).send({ error: "Select each resource once. Use quantity to request multiple units." });
    }
    // Every batch locks the occurrence first and takes resource locks in the same order.
    selections.sort((left, right) => left.resourceId.localeCompare(right.resourceId));
    const client = await context.pool!.connect();
    const created: Array<{ resourceId: string; seriesId: string; bookingId: string }> = [];
    let resourceName = "";
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This location is read-only on this installation." });
      }
      const site = (await client.query<{ time_zone: string }>("SELECT time_zone FROM departments WHERE id=$1", [departmentId])).rows[0];
      if (!site || !await calendarLinkingAvailable(client, departmentId, true)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The General Calendar module must be active to link an appointment." });
      }
      if (!isValidTimeZone(site.time_zone)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Configure a valid location time zone before booking." });
      }
      const window = await lockOccurrenceWindow(client, request, departmentId, appointmentId, occurrenceStart, site.time_zone);
      if (!window) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Shared calendar occurrence not found in this location." });
      }
      if (Date.parse(window.startsAtUtc) !== startsAt.getTime() || Date.parse(window.endsAtUtc) !== endsAt.getTime()) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The appointment time changed. Refresh Calendar before booking." });
      }
      const instances = [{ startsAt, endsAt, localDate: occurrenceDateKey(startsAt, site.time_zone) }];
      for (const selection of selections) {
        const policy = await lockResourceBookingPolicy(client, departmentId, selection.resourceId);
        if (!policy?.active) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "One of the selected resources is no longer active in this location." });
        }
        resourceName = policy.name;
        const booking = await insertBookingSeries(client, {
          ...selection, departmentId, userId: request.authenticatedUser!.id, purpose, startsAt, endsAt,
          timeZone: site.time_zone, repeat: { frequency: "once" }, extraDates: [], excludedDates: [],
          instances, status: "approved", appointmentId, occurrenceStart,
        });
        created.push({ resourceId: selection.resourceId, seriesId: booking.seriesId, bookingId: booking.bookingIds[0] });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && (error.code === "23P01" || error.code === "23505")) {
        return reply.code(409).send({ error: `${resourceName} conflicts with an existing reservation or exceeds available units. No resources were booked.` });
      }
      throw error;
    } finally { client.release(); }
    context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
    context.realtime.publish("module:church-calendar:changed", departmentId, {});
    return reply.code(201).send({ bookings: created });
  });

  app.post<{ Body: SeriesInput }>("/api/modules/resource-scheduler/series", {
    schema: { body: { type: "object", additionalProperties: false, required: ["resourceId", "purpose", "startsAt", "endsAt"], properties: {
      resourceId: { type: "string", format: "uuid" }, purpose: { type: "string", minLength: 1, maxLength: 240 }, startsAt: { type: "string", format: "date-time" }, endsAt: { type: "string", format: "date-time" },
      quantity: { type: "integer", minimum: 1, maximum: 10000 }, leadInMinutes: { type: "integer", minimum: 0, maximum: 10080 }, cleanupMinutes: { type: "integer", minimum: 0, maximum: 10080 },
      recurrence: { type: "object", additionalProperties: false, properties: { frequency: { type: "string", enum: ["once", "daily", "weekly", "monthly", "yearly"] }, interval: { type: "integer", minimum: 1, maximum: 366 }, endsOn: { type: "string", format: "date" }, count: { type: "integer", minimum: 1, maximum: 500 }, weekdays: { type: "array", maxItems: 7, items: { type: "integer", minimum: 0, maximum: 6 } } } },
      extraDates: { type: "array", maxItems: 100, items: { type: "string", format: "date" } }, excludedDates: { type: "array", maxItems: 100, items: { type: "string", format: "date" } }, linkedAppointmentId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
      allDayDate: { type: "string", format: "date" },
      beneficiaryContactId: { type: "string", format: "uuid" },
      subtitle: { type: "string", maxLength: 240 }, description: { type: "string", maxLength: 2000 },
      linkedOccurrenceStartAt: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$" },
    } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    const startsAt = new Date(request.body.startsAt); const endsAt = new Date(request.body.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) return reply.code(400).send({ error: "Choose a valid start and end time." });
    const now = Date.now();
    if (startsAt.getTime() < now - 60_000 || startsAt.getTime() > now + 366 * 86_400_000) return reply.code(400).send({ error: "Choose a start within the next twelve months." });
    const repeat = request.body.recurrence ?? { frequency: "once" as const };
    if (repeat.endsOn && !isoDate(repeat.endsOn)) return reply.code(400).send({ error: "Choose a valid repeat end date." });
    const extraDates = request.body.extraDates ?? []; const excludedDates = request.body.excludedDates ?? [];
    if ([...extraDates, ...excludedDates].some((date) => !isoDate(date))) return reply.code(400).send({ error: "Extra and excluded dates must be valid calendar dates." });
    const resourceResult = await context.pool!.query<{ id: string; name: string; requires_approval: boolean; total_units: number; default_lead_in_minutes: number; default_cleanup_minutes: number }>(
      `SELECT resource.id,resource.name,resource.requires_approval,COALESCE(settings.total_units,1)::int AS total_units,
              COALESCE(settings.default_lead_in_minutes,0)::int AS default_lead_in_minutes,COALESCE(settings.default_cleanup_minutes,0)::int AS default_cleanup_minutes
         FROM bookable_resources resource LEFT JOIN resource_scheduler_settings settings ON settings.department_id=resource.department_id AND settings.resource_id=resource.id
        WHERE resource.id=$1 AND resource.department_id=$2 AND resource.active=true
          AND can_view_bookable_resource(resource.department_id,resource.visibility_group_id,$3,$4)`, [request.body.resourceId, departmentId, request.authenticatedUser!.id, isManager(request)]);
    const resource = resourceResult.rows[0];
    if (!resource) return reply.code(404).send({ error: "Choose an active resource in this location." });
    const appointmentId = request.body.linkedAppointmentId ?? null;
    const occurrenceStart = cleanLocalDateTime(request.body.linkedOccurrenceStartAt);
    if (request.body.linkedOccurrenceStartAt !== undefined && (!appointmentId || !occurrenceStart || repeat.frequency !== "once" || extraDates.length || excludedDates.length)) {
      return reply.code(400).send({ error: "Choose one saved calendar occurrence for this booking." });
    }
    if (appointmentId && !isManager(request)) {
      return reply.code(403).send({ error: "Resource managers are required to link bookings to shared calendar appointments." });
    }
    const quantity = request.body.quantity ?? 1;
    if (quantity > resource.total_units) return reply.code(400).send({ error: "Quantity exceeds this resource's available units." });
    const leadInMinutes = request.body.leadInMinutes ?? resource.default_lead_in_minutes;
    const cleanupMinutes = request.body.cleanupMinutes ?? resource.default_cleanup_minutes;
    const zoneResult = await context.pool!.query<{ time_zone: string }>("SELECT time_zone FROM departments WHERE id=$1", [departmentId]);
    const timeZone = zoneResult.rows[0]?.time_zone ?? "UTC";
    if (!isValidTimeZone(timeZone)) return reply.code(409).send({ error: "Configure a valid location time zone before creating recurring bookings." });
    const { allDayDate, beneficiaryContactId } = request.body;
    if (beneficiaryContactId && !canBookForOthers(request)) {
      return reply.code(403).send({ error: "Resource management and private People access are required to book for someone else." });
    }
    if (allDayDate !== undefined) {
      if (!isoDate(allDayDate) || occurrenceStart || (repeat.frequency === "once" && (repeat.endsOn || repeat.count || repeat.weekdays?.length || extraDates.length || excludedDates.length))) {
        return reply.code(400).send({ error: "Choose a valid start date and repeat rule for the full-day booking." });
      }
      try {
        const { startsAt: expectedStart, endsAt: expectedEnd } = fullDayBounds(allDayDate, timeZone);
        if (+expectedStart !== +startsAt || +expectedEnd !== +endsAt) {
          return reply.code(400).send({ error: "Full-day bookings must match the location's full calendar day." });
        }
      } catch {
        return reply.code(400).send({ error: "Could not resolve the full-day booking date in this location." });
      }
    }
    let instances: ReturnType<typeof seriesDates>;
    if (allDayDate) {
      try {
        instances = seriesDatesInTimeZone(startsAt, endsAt, repeat, extraDates, excludedDates, timeZone, true);
      } catch {
        return reply.code(400).send({ error: "A full-day booking date could not be resolved in this location." });
      }
    } else {
      instances = occurrenceStart
        ? [{ startsAt, endsAt, localDate: occurrenceDateKey(startsAt, timeZone) }]
        : seriesDates(startsAt, endsAt, repeat, extraDates, excludedDates, timeZone);
    }
    if (!instances.length) return reply.code(400).send({ error: "This repeat rule has no occurrences in its date range." });
    const client = await context.pool!.connect();
    let created: Awaited<ReturnType<typeof insertBookingSeries>>;
    let status: "requested" | "approved";
    try {
      await client.query("BEGIN");
      if (!await context.lockDepartmentForWrite(client, departmentId)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "This location is read-only on this installation." });
      }
      if (appointmentId && !await calendarLinkingAvailable(client, departmentId, Boolean(occurrenceStart))) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "The General Calendar module must be active to link an appointment." });
      }
      if (appointmentId && occurrenceStart) {
        const window = await lockOccurrenceWindow(client, request, departmentId, appointmentId, occurrenceStart, timeZone);
        if (!window) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Shared calendar occurrence not found in this location." });
        }
        if (Date.parse(window.startsAtUtc) !== startsAt.getTime() || Date.parse(window.endsAtUtc) !== endsAt.getTime()) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "The appointment time changed. Refresh Calendar before booking." });
        }
      } else if (appointmentId && !await lockLinkableAppointment(client, request, departmentId, appointmentId)) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Shared calendar appointment not found in this location." });
      }
      const policy = await lockResourceBookingPolicy(client, departmentId, request.body.resourceId);
      if (!policy?.active) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Choose an active resource in this location." }); }
      if (!await canViewResource(client, departmentId, policy.visibility_group_id, request.authenticatedUser!.id, isManager(request))) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Choose an active resource in this location." });
      }
      if (policy.manager_booking_only && !isManager(request)) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: resourceManagerRequired });
      }
      if (policy.calendar_required && (!appointmentId || !occurrenceStart)) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: resourceCalendarRequired });
      }
      if (beneficiaryContactId) {
        const beneficiary = await client.query("SELECT id FROM contacts WHERE id=$1 AND department_id=$2 AND archived_at IS NULL FOR SHARE",
          [beneficiaryContactId, departmentId]);
        if (!beneficiary.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Choose an active People record from this location." });
        }
      }
      status = policy.requires_approval && !isManager(request) ? "requested" : "approved";
      created = await insertBookingSeries(client, {
        departmentId, resourceId: policy.id, userId: request.authenticatedUser!.id,
        purpose: request.body.purpose.trim(), subtitle: request.body.subtitle?.trim(), description: request.body.description?.trim(), startsAt, endsAt, timeZone, repeat, extraDates, excludedDates,
        instances, quantity, leadInMinutes, cleanupMinutes, status, appointmentId, occurrenceStart, allDayDate, beneficiaryContactId,
      });
      if (status === "requested") await recordPendingResourceBookingRequest(client, departmentId, request.authenticatedUser!.id, created.bookingIds);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && (error.code === "23P01" || error.code === "23505")) return reply.code(409).send({ error: error instanceof Error ? error.message : "A booking conflicts with resource availability." });
      throw error;
    } finally { client.release(); }
    context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
    if (appointmentId) context.realtime.publish("module:church-calendar:changed", departmentId, {});
    return reply.code(201).send({ ...created, occurrenceCount: instances.length, status });
  });

  const futureEditSchema = { type: "object", additionalProperties: false, required: ["fromDate", "purpose", "startsAt", "endsAt", "quantity", "leadInMinutes", "cleanupMinutes", "recurrence"], properties: {
    fromDate: { type: "string", format: "date" }, purpose: { type: "string", minLength: 1, maxLength: 240 }, subtitle: { type: "string", maxLength: 240 }, description: { type: "string", maxLength: 2000 }, startsAt: { type: "string", format: "date-time" }, endsAt: { type: "string", format: "date-time" },
    quantity: { type: "integer", minimum: 1, maximum: 10000 }, leadInMinutes: { type: "integer", minimum: 0, maximum: 10080 }, cleanupMinutes: { type: "integer", minimum: 0, maximum: 10080 },
    recurrence: { type: "object", additionalProperties: false, required: ["frequency"], properties: { frequency: { type: "string", enum: ["once", "daily", "weekly", "monthly", "yearly"] }, interval: { type: "integer", minimum: 1, maximum: 366 }, endsOn: { type: "string", format: "date" }, count: { type: "integer", minimum: 1, maximum: 500 }, weekdays: { type: "array", maxItems: 7, items: { type: "integer", minimum: 0, maximum: 6 } } } },
  } };
  app.post<{ Params: { seriesId: string }; Body: FutureEditInput }>("/api/modules/resource-scheduler/series/:seriesId/edit-preview", {
    schema: { params: { type: "object", required: ["seriesId"], properties: { seriesId: { type: "string", format: "uuid" } } }, body: futureEditSchema },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    const access = await context.pool!.query("SELECT requested_by FROM resource_booking_series WHERE id=$1 AND department_id=$2 AND archived_at IS NULL", [request.params.seriesId, departmentId]);
    if (!access.rowCount) return reply.code(404).send({ error: "Booking series not found in this location." });
    if (access.rows[0].requested_by !== request.authenticatedUser!.id && !isManager(request)) return reply.code(403).send({ error: "Only the series owner or a resource manager can edit future occurrences." });
    const result = await calculateFutureEdit(departmentId, request.params.seriesId, request.body, context.pool!);
    if ("error" in result) return reply.code(400).send({ error: result.error });
    const calendarRequired = result.calendarRequired && result.addedCount > 0;
    const visibilityRequired = result.addedCount > 0 && !await canViewResource(context.pool!, departmentId,
      result.visibilityGroupId, request.authenticatedUser!.id, isManager(request));
    const managerRequired = result.managerBookingOnly && result.addedCount > 0 && !isManager(request);
    return { fromDate: request.body.fromDate, occurrenceCount: result.proposed.length, addedCount: result.addedCount,
      updatedCount: result.updatedCount, cancelledCount: result.cancelledCount, approvedCount: result.approvedCount,
      blocked: result.approvedCount > 0 || calendarRequired || managerRequired || visibilityRequired, calendarRequired, managerRequired, visibilityRequired };

  });
  app.put<{ Params: { seriesId: string }; Body: FutureEditInput }>("/api/modules/resource-scheduler/series/:seriesId/edit-future", {
    schema: { params: { type: "object", required: ["seriesId"], properties: { seriesId: { type: "string", format: "uuid" } } }, body: futureEditSchema },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    const client = await context.pool!.connect();
    let summary: { addedCount: number; updatedCount: number; cancelledCount: number } | null = null;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [departmentId, request.params.seriesId]);
      const locked = await client.query("SELECT id,requested_by FROM resource_booking_series WHERE id=$1 AND department_id=$2 AND archived_at IS NULL FOR UPDATE", [request.params.seriesId, departmentId]);
      if (!locked.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Booking series not found in this location." }); }
      if (locked.rows[0].requested_by !== request.authenticatedUser!.id && !isManager(request)) { await client.query("ROLLBACK"); return reply.code(403).send({ error: "Only the series owner or a resource manager can edit future occurrences." }); }
      const plan = await calculateFutureEdit(departmentId, request.params.seriesId, request.body, client, true);
      if ("error" in plan) { await client.query("ROLLBACK"); return reply.code(400).send({ error: plan.error }); }
      if (plan.approvedCount) { await client.query("ROLLBACK"); return reply.code(409).send({ error: `${plan.approvedCount} future occurrence(s) are already approved. No changes were made; handle those bookings individually before editing the series.` }); }
      if (plan.addedCount > 0 && plan.series.linked_appointment_id) {
        if (!isManager(request)) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Resource managers are required to link bookings to shared calendar appointments." });
        }
        if (!await calendarLinkingAvailable(client, departmentId, false)) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "The General Calendar module must be active to link an appointment." });
        }
        if (!await lockLinkableAppointment(client, request, departmentId, plan.series.linked_appointment_id)) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Shared calendar appointment not found in this location." });
        }
      }
      if (plan.addedCount > 0) {
        const policy = await lockResourceBookingPolicy(client, departmentId, plan.series.resource_id);
        if (!policy?.active) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Choose an active resource in this location." }); }
        if (!await canViewResource(client, departmentId, policy.visibility_group_id, request.authenticatedUser!.id, isManager(request))) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Choose an active resource in this location." });
        }
        if (policy.manager_booking_only && !isManager(request)) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: resourceManagerRequired });
        }
        if (policy.calendar_required) { await client.query("ROLLBACK"); return reply.code(409).send({ error: resourceCalendarRequired }); }
      }
      const input = request.body;
      const subtitle = input.subtitle?.trim() ?? plan.series.subtitle;
      const description = input.description?.trim() ?? plan.series.description;
      const currentByDate = new Map<string, { id: string; occurrenceStartsAt: Date; hasOccurrenceOverride: boolean }>(plan.requested.map((row: { id: string; occurrenceStartsAt: Date; occurrenceDate: string; hasOccurrenceOverride: boolean }) => [row.occurrenceDate, row] as const));
      const proposedDates = new Set(plan.proposed.map((item) => item.localDate));
      const canceledIds = plan.requested.filter((row: { occurrenceDate: string }) => !proposedDates.has(row.occurrenceDate)).map((row: { id: string }) => row.id);
      if (canceledIds.length) {
        await client.query("UPDATE resource_bookings SET status='cancelled',updated_at=now() WHERE department_id=$1 AND id=ANY($2::uuid[]) AND status='requested'", [departmentId, canceledIds]);
        await client.query("DELETE FROM resource_booking_series_occurrence_overrides WHERE series_id=$1 AND resource_booking_id=ANY($2::uuid[])", [request.params.seriesId, canceledIds]);
      }
      await client.query(`UPDATE resource_booking_series SET purpose=$3,starts_at=$4,ends_at=$5,recurrence=$6::jsonb,quantity=$7,lead_in_minutes=$8,cleanup_minutes=$9,subtitle=$10,description=$11,updated_at=now() WHERE id=$1 AND department_id=$2`, [request.params.seriesId, departmentId, input.purpose.trim(), plan.startsAt, plan.endsAt, JSON.stringify(input.recurrence), input.quantity, input.leadInMinutes, input.cleanupMinutes, subtitle, description]);
      let addedCount = 0; let updatedCount = 0;
      const extrasResult = await client.query("SELECT occurrence_date::text AS date FROM resource_booking_series_dates WHERE series_id=$1 AND date_type='extra'", [request.params.seriesId]);
      const extras = new Set(extrasResult.rows.map((row: { date: string }) => row.date));
      for (const occurrence of plan.proposed) {
        const date = occurrence.localDate;
        const existing = currentByDate.get(date);
        if (existing) {
          if (existing.hasOccurrenceOverride) {
            await client.query("UPDATE resource_bookings SET purpose=$3,lead_in_minutes=$4,cleanup_minutes=$5,subtitle=$6,description=$7,updated_at=now() WHERE id=$1 AND department_id=$2 AND status='requested'", [existing.id, departmentId, input.purpose.trim(), input.leadInMinutes, input.cleanupMinutes, subtitle, description]);
          } else {
            await client.query("UPDATE resource_bookings SET purpose=$3,starts_at=$4,ends_at=$5,quantity=$6,lead_in_minutes=$7,cleanup_minutes=$8,subtitle=$9,description=$10,updated_at=now() WHERE id=$1 AND department_id=$2 AND status='requested'", [existing.id, departmentId, input.purpose.trim(), occurrence.startsAt, occurrence.endsAt, input.quantity, input.leadInMinutes, input.cleanupMinutes, subtitle, description]);
          }
          await client.query("UPDATE resource_booking_series_occurrences SET occurrence_starts_at=$3 WHERE series_id=$1 AND resource_booking_id=$2 AND department_id=$4", [request.params.seriesId, existing.id, occurrence.startsAt, departmentId]);
          updatedCount++;
        } else {
          await client.query("DELETE FROM resource_booking_series_occurrence_overrides WHERE series_id=$1 AND occurrence_date=$2::date", [request.params.seriesId, date]);
          const bookingId = randomUUID();
          await client.query(`INSERT INTO resource_bookings(id,department_id,resource_id,requested_by,purpose,starts_at,ends_at,status,quantity,lead_in_minutes,cleanup_minutes,subtitle,description,beneficiary_contact_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,'requested',$8,$9,$10,$11,$12,
              (SELECT id FROM contacts WHERE id=$13 AND department_id=$2 AND archived_at IS NULL))`, [bookingId, departmentId, plan.series.resource_id, plan.series.requested_by, input.purpose.trim(), occurrence.startsAt, occurrence.endsAt, input.quantity, input.leadInMinutes, input.cleanupMinutes, subtitle, description, plan.series.beneficiary_contact_id]);
          await client.query(`INSERT INTO resource_booking_series_occurrences(id,department_id,series_id,resource_booking_id,occurrence_starts_at,is_extra_date) VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(series_id,occurrence_starts_at) DO UPDATE SET resource_booking_id=EXCLUDED.resource_booking_id,is_extra_date=EXCLUDED.is_extra_date`, [randomUUID(), departmentId, request.params.seriesId, bookingId, occurrence.startsAt, extras.has(date)]);
          if (plan.series.linked_appointment_id) {
            await client.query("INSERT INTO church_calendar_resource_links(appointment_id,resource_booking_id,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [plan.series.linked_appointment_id, bookingId, request.authenticatedUser!.id]);
          }
          addedCount++;
        }
      }
      summary = { addedCount, updatedCount, cancelledCount: canceledIds.length };
      await client.query("INSERT INTO resource_scheduler_audit(id,department_id,actor_user_id,action,series_id,details) VALUES($1,$2,$3,'series_future_edited',$4,$5::jsonb)", [randomUUID(), departmentId, request.authenticatedUser!.id, request.params.seriesId, JSON.stringify({ fromDate: input.fromDate, previous: { purpose: plan.series.purpose, subtitle: plan.series.subtitle, description: plan.series.description, startsAt: plan.series.starts_at, endsAt: plan.series.ends_at, recurrence: plan.series.recurrence, quantity: plan.series.quantity, leadInMinutes: plan.series.lead_in_minutes, cleanupMinutes: plan.series.cleanup_minutes }, next: { ...input, subtitle, description }, ...summary })]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && (error.code === "23P01" || error.code === "23505")) return reply.code(409).send({ error: "The proposed future occurrences conflict with resource availability. No changes were made." });
      throw error;
    } finally { client.release(); }
    context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
    return { ok: true, ...summary };
  });

  app.put<{ Params: { seriesId: string; date: string }; Body: { startsAt: string; endsAt: string; quantity: number; allDay?: boolean } }>("/api/modules/resource-scheduler/series/:seriesId/occurrences/:date", {
    schema: {
      params: { type: "object", required: ["seriesId", "date"], properties: { seriesId: { type: "string", format: "uuid" }, date: { type: "string", format: "date" } } },
      body: { type: "object", additionalProperties: false, required: ["startsAt", "endsAt", "quantity"], properties: { startsAt: { type: "string", format: "date-time" }, endsAt: { type: "string", format: "date-time" }, quantity: { type: "integer", minimum: 1, maximum: 10000 }, allDay: { type: "boolean" } } },
    },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    if (!isoDate(request.params.date)) return reply.code(400).send({ error: "Choose a valid occurrence date." });
    const startsAt = new Date(request.body.startsAt); const endsAt = new Date(request.body.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) return reply.code(400).send({ error: "Choose a valid start and end time." });
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [departmentId, request.params.seriesId]);
      const found = await client.query(`SELECT series.id,series.requested_by,series.resource_id,series.time_zone,series.all_day_date,booking.id AS booking_id,booking.status,
          booking.starts_at,booking.ends_at,booking.quantity,COALESCE(settings.total_units,1)::int AS total_units
        FROM resource_booking_series series
        JOIN resource_booking_series_occurrences occurrence ON occurrence.series_id=series.id AND occurrence.department_id=series.department_id
        JOIN resource_bookings booking ON booking.id=occurrence.resource_booking_id AND booking.department_id=series.department_id
        JOIN bookable_resources resource ON resource.id=series.resource_id AND resource.department_id=series.department_id AND resource.active=true
        LEFT JOIN resource_scheduler_settings settings ON settings.department_id=series.department_id AND settings.resource_id=series.resource_id
        WHERE series.id=$1 AND series.department_id=$2 AND series.archived_at IS NULL
          AND (occurrence.occurrence_starts_at AT TIME ZONE COALESCE(series.time_zone,'UTC'))::date=$3::date
        FOR UPDATE OF series,booking`, [request.params.seriesId, departmentId, request.params.date]);
      const row = found.rows[0];
      if (!row) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "No booking occurrence exists on this date." }); }
      if (row.requested_by !== request.authenticatedUser!.id && !isManager(request)) { await client.query("ROLLBACK"); return reply.code(403).send({ error: "Only the series owner or a resource manager can edit this occurrence." }); }
      const today = occurrenceDateKey(new Date(), row.time_zone ?? null);
      if (request.params.date < today) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Only future occurrences can be edited." }); }
      const { allDay } = request.body;
      if (row.all_day_date ? allDay === undefined : allDay === true) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "Choose a valid full-day setting for this booking series." });
      }
      if (allDay) {
        const fullDay = fullDayBounds(request.params.date, row.time_zone);
        if (+fullDay.startsAt !== +startsAt || +fullDay.endsAt !== +endsAt) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Full-day bookings must occupy the full date in the series time zone." });
        }
      } else if (occurrenceDateKey(startsAt, row.time_zone ?? null) !== request.params.date || occurrenceDateKey(endsAt, row.time_zone ?? null) !== request.params.date) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "Choose a valid start and end time on the selected location date." });
      }
      if (row.status !== "requested") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Only pending occurrences can be edited. Cancel or resolve a confirmed occurrence individually first." }); }
      if (request.body.quantity > Number(row.total_units)) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Quantity exceeds this resource's available units." }); }
      await client.query("UPDATE resource_bookings SET starts_at=$3,ends_at=$4,quantity=$5,updated_at=now() WHERE id=$1 AND department_id=$2 AND status='requested'", [row.booking_id, departmentId, startsAt, endsAt, request.body.quantity]);
      await client.query(`INSERT INTO resource_booking_series_occurrence_overrides(series_id,occurrence_date,resource_booking_id,updated_by,all_day)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(series_id,occurrence_date) DO UPDATE SET resource_booking_id=EXCLUDED.resource_booking_id,updated_by=EXCLUDED.updated_by,all_day=EXCLUDED.all_day,updated_at=now()`, [request.params.seriesId, request.params.date, row.booking_id, request.authenticatedUser!.id, row.all_day_date ? allDay : null]);
      await client.query("INSERT INTO resource_scheduler_audit(id,department_id,actor_user_id,action,series_id,booking_id,details) VALUES($1,$2,$3,'occurrence_overridden',$4,$5,$6::jsonb)", [randomUUID(), departmentId, request.authenticatedUser!.id, request.params.seriesId, row.booking_id, JSON.stringify({ date: request.params.date, previous: { startsAt: row.starts_at, endsAt: row.ends_at, quantity: row.quantity }, next: { startsAt, endsAt, quantity: request.body.quantity, ...(row.all_day_date ? { allDay } : {}) } })]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && error.code === "23P01") return reply.code(409).send({ error: "The new time or quantity conflicts with resource availability." });
      throw error;
    } finally { client.release(); }
    context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
    return { ok: true };
  });

  app.delete<{ Params: { seriesId: string; date: string } }>("/api/modules/resource-scheduler/series/:seriesId/occurrences/:date/override", {
    schema: { params: { type: "object", required: ["seriesId", "date"], properties: { seriesId: { type: "string", format: "uuid" }, date: { type: "string", format: "date" } } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    if (!isoDate(request.params.date)) return reply.code(400).send({ error: "Choose a valid occurrence date." });
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [departmentId, request.params.seriesId]);
      const found = await client.query(`SELECT series.id,series.requested_by,series.time_zone,series.all_day_date,series.starts_at AS series_starts_at,series.ends_at AS series_ends_at,series.quantity AS series_quantity,
          series.lead_in_minutes,series.cleanup_minutes,booking.id AS booking_id,booking.status,booking.starts_at,booking.ends_at,booking.quantity
        FROM resource_booking_series series
        JOIN resource_booking_series_occurrence_overrides override ON override.series_id=series.id AND override.occurrence_date=$3::date
        JOIN resource_booking_series_occurrences occurrence ON occurrence.series_id=series.id AND occurrence.department_id=series.department_id AND occurrence.resource_booking_id=override.resource_booking_id
        JOIN resource_bookings booking ON booking.id=override.resource_booking_id AND booking.department_id=series.department_id
        WHERE series.id=$1 AND series.department_id=$2 AND series.archived_at IS NULL FOR UPDATE OF series,booking`, [request.params.seriesId, departmentId, request.params.date]);
      const row = found.rows[0];
      if (!row) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "No occurrence override exists on this date." }); }
      if (request.params.date < occurrenceDateKey(new Date(), row.time_zone ?? null)) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Only future occurrences can be reset." }); }
      if (row.requested_by !== request.authenticatedUser!.id && !isManager(request)) { await client.query("ROLLBACK"); return reply.code(403).send({ error: "Only the series owner or a resource manager can reset this occurrence." }); }
      if (row.status !== "requested") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Only pending occurrences can be reset. Cancel or resolve a confirmed occurrence individually first." }); }
      const { startsAt, endsAt } = row.all_day_date
        ? fullDayBounds(request.params.date, row.time_zone)
        : occurrenceAtDate(new Date(row.series_starts_at), new Date(row.series_ends_at), request.params.date, row.time_zone ?? null);
      await client.query("UPDATE resource_bookings SET starts_at=$3,ends_at=$4,quantity=$5,lead_in_minutes=$6,cleanup_minutes=$7,updated_at=now() WHERE id=$1 AND department_id=$2 AND status='requested'", [row.booking_id, departmentId, startsAt, endsAt, row.series_quantity, row.lead_in_minutes, row.cleanup_minutes]);
      await client.query("DELETE FROM resource_booking_series_occurrence_overrides WHERE series_id=$1 AND occurrence_date=$2::date", [request.params.seriesId, request.params.date]);
      await client.query("INSERT INTO resource_scheduler_audit(id,department_id,actor_user_id,action,series_id,booking_id,details) VALUES($1,$2,$3,'occurrence_override_reset',$4,$5,$6::jsonb)", [randomUUID(), departmentId, request.authenticatedUser!.id, request.params.seriesId, row.booking_id, JSON.stringify({ date: request.params.date, previous: { startsAt: row.starts_at, endsAt: row.ends_at, quantity: row.quantity }, restored: { startsAt, endsAt, quantity: row.series_quantity, ...(row.all_day_date ? { allDay: true } : {}) } })]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && error.code === "23P01") return reply.code(409).send({ error: "The series default time or quantity conflicts with resource availability." });
      throw error;
    } finally { client.release(); }
    context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
    return { ok: true };
  });

  app.post<{ Params: { seriesId: string }; Body: { date: string } }>("/api/modules/resource-scheduler/series/:seriesId/extra-dates", {
    schema: { params: { type: "object", required: ["seriesId"], properties: { seriesId: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["date"], properties: { date: { type: "string", format: "date" } } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    if (!isoDate(request.body.date)) return reply.code(400).send({ error: "Choose a valid date." });
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query("SELECT * FROM resource_booking_series WHERE id=$1 AND department_id=$2 AND archived_at IS NULL FOR UPDATE", [request.params.seriesId, departmentId]);
      const series = found.rows[0];
      if (!series) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Booking series not found." }); }
      if (!isManager(request) && series.requested_by !== request.authenticatedUser!.id) { await client.query("ROLLBACK"); return reply.code(403).send({ error: "You can only edit your own booking series." }); }
      if (series.all_day_date && series.recurrence?.frequency === "once") { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Choose a recurring full-day booking to add an extra date." }); }
      if (request.body.date < occurrenceDateKey(new Date(), series.time_zone ?? null)) { await client.query("ROLLBACK"); return reply.code(400).send({ error: "Choose a future date." }); }
      let window: ReturnType<typeof occurrenceAtDate>;
      try {
        window = series.all_day_date
          ? fullDayBounds(request.body.date, series.time_zone)
          : occurrenceAtDate(new Date(series.starts_at), new Date(series.ends_at), request.body.date, series.time_zone ?? null);
      } catch (error) {
        if (!series.all_day_date) throw error;
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "This date could not be resolved in the series time zone." });
      }
      const { startsAt, endsAt } = window;
      if (series.all_day_date && (endsAt <= startsAt || startsAt.getTime() > Date.now() + 366 * DAY_MS)) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "Choose a valid full day within the next twelve months." });
      }
      const existingFullDay = series.all_day_date ? await client.query<{ id: string }>(
        `SELECT booking.id FROM resource_booking_series_occurrences occurrence
           JOIN resource_bookings booking ON booking.id=occurrence.resource_booking_id AND booking.department_id=occurrence.department_id
          WHERE occurrence.series_id=$1 AND occurrence.department_id=$2 AND occurrence.occurrence_starts_at=$3
            AND booking.status IN ('requested','approved') FOR UPDATE OF booking`,
        [series.id, departmentId, startsAt],
      ) : null;
      if (series.all_day_date && series.linked_appointment_id && !existingFullDay?.rowCount) {
        if (!isManager(request)) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Resource managers are required to link bookings to shared appointments." });
        }
        if (!await calendarLinkingAvailable(client, departmentId, false) ||
            !await lockLinkableAppointment(client, request, departmentId, series.linked_appointment_id)) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "The linked appointment is no longer available." });
        }
      }
      const policy = await lockResourceBookingPolicy(client, departmentId, series.resource_id);
      if (!policy?.active) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Choose an active resource in this location." }); }
      if (!await canViewResource(client, departmentId, policy.visibility_group_id, request.authenticatedUser!.id, isManager(request))) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Choose an active resource in this location." });
      }
      if (policy.manager_booking_only && !isManager(request)) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: resourceManagerRequired });
      }
      if (policy.calendar_required) { await client.query("ROLLBACK"); return reply.code(409).send({ error: resourceCalendarRequired }); }
      await client.query("DELETE FROM resource_booking_series_dates WHERE series_id=$1 AND occurrence_date=$2 AND date_type='excluded'", [series.id, request.body.date]);
      await client.query("INSERT INTO resource_booking_series_dates(series_id,occurrence_date,date_type,created_by) VALUES($1,$2,'extra',$3) ON CONFLICT DO NOTHING", [series.id, request.body.date, request.authenticatedUser!.id]);
      const bookingId = randomUUID();
      const status = series.all_day_date ? (policy.requires_approval && !isManager(request) ? "requested" : "approved") : series.initial_status ?? "requested";
      const existingBookingId = existingFullDay?.rows[0]?.id;
      if (!existingBookingId) await client.query(`INSERT INTO resource_bookings(id,department_id,resource_id,requested_by,purpose,starts_at,ends_at,status,quantity,lead_in_minutes,cleanup_minutes,subtitle,description,beneficiary_contact_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
          (SELECT id FROM contacts WHERE id=$14 AND department_id=$2 AND archived_at IS NULL))
        ${series.all_day_date ? "" : "ON CONFLICT DO NOTHING"}`, [bookingId, departmentId, series.resource_id, series.requested_by, series.purpose, startsAt, endsAt, status, series.quantity, series.lead_in_minutes, series.cleanup_minutes, series.subtitle, series.description, series.beneficiary_contact_id]);
      const finalBookingId = series.all_day_date ? existingBookingId ?? bookingId : (await client.query(
        "SELECT id FROM resource_bookings WHERE department_id=$1 AND resource_id=$2 AND starts_at=$3",
        [departmentId, series.resource_id, startsAt],
      )).rows[0]?.id;
      if (!finalBookingId) throw new Error("The extra occurrence could not be created.");
      await client.query("INSERT INTO resource_booking_series_occurrences(id,department_id,series_id,resource_booking_id,occurrence_starts_at,is_extra_date) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(series_id,occurrence_starts_at) DO UPDATE SET is_extra_date=true,resource_booking_id=CASE WHEN $6 THEN EXCLUDED.resource_booking_id ELSE resource_booking_series_occurrences.resource_booking_id END", [randomUUID(), departmentId, series.id, finalBookingId, startsAt, Boolean(series.all_day_date)]);
      if (series.all_day_date && !existingBookingId && series.linked_appointment_id) {
        await client.query("INSERT INTO church_calendar_resource_links(appointment_id,resource_booking_id,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [series.linked_appointment_id, finalBookingId, request.authenticatedUser!.id]);
      }
      if (series.all_day_date && !existingBookingId && status === "requested") await recordPendingResourceBookingRequest(client, departmentId, series.requested_by, [finalBookingId]);
      await client.query("INSERT INTO resource_scheduler_audit(id,department_id,actor_user_id,action,series_id,booking_id,details) VALUES($1,$2,$3,'extra_date_added',$4,$5,$6::jsonb)", [randomUUID(), departmentId, request.authenticatedUser!.id, series.id, finalBookingId, JSON.stringify({ date: request.body.date })]);
      await client.query("COMMIT");
      context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
      return reply.code(201).send({ bookingId: finalBookingId, startsAt, endsAt });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && (error.code === "23P01" || error.code === "23505")) {
        return reply.code(409).send({ error: "The extra occurrence conflicts with resource availability. No changes were made." });
      }
      throw error;
    }
    finally { client.release(); }
  });

  app.get<{ Params: { seriesId: string } }>("/api/modules/resource-scheduler/series/:seriesId/extra-dates", {
    schema: { params: { type: "object", required: ["seriesId"], properties: { seriesId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    const series = await context.pool!.query("SELECT requested_by,time_zone FROM resource_booking_series WHERE id=$1 AND department_id=$2", [request.params.seriesId, departmentId]);
    if (!series.rowCount) return reply.code(404).send({ error: "Booking series not found." });
    if (!isManager(request) && series.rows[0].requested_by !== request.authenticatedUser!.id) return reply.code(403).send({ error: "You can only manage extra dates in your own booking series." });
    return (await context.pool!.query(
      `SELECT dates.occurrence_date::text AS date,booking.id AS "bookingId",booking.status,booking.starts_at AS "startsAt",booking.ends_at AS "endsAt"
         FROM resource_booking_series_dates dates
         JOIN resource_booking_series series ON series.id=dates.series_id AND series.department_id=$2
         LEFT JOIN resource_booking_series_occurrences occurrence ON occurrence.series_id=dates.series_id AND occurrence.department_id=$2
           AND occurrence.is_extra_date AND (occurrence.occurrence_starts_at AT TIME ZONE COALESCE(series.time_zone,'UTC'))::date=dates.occurrence_date
         LEFT JOIN resource_bookings booking ON booking.id=occurrence.resource_booking_id AND booking.department_id=$2
        WHERE dates.series_id=$1 AND dates.date_type='extra' ORDER BY dates.occurrence_date`,
      [request.params.seriesId, departmentId],
    )).rows;
  });

  app.delete<{ Params: { seriesId: string; date: string } }>("/api/modules/resource-scheduler/series/:seriesId/extra-dates/:date", {
    schema: { params: { type: "object", required: ["seriesId", "date"], properties: { seriesId: { type: "string", format: "uuid" }, date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    if (!isoDate(request.params.date)) return reply.code(400).send({ error: "Choose a valid date." });
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query("SELECT * FROM resource_booking_series WHERE id=$1 AND department_id=$2 AND archived_at IS NULL FOR UPDATE", [request.params.seriesId, departmentId]);
      const series = found.rows[0];
      if (!series) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Booking series not found." }); }
      if (!isManager(request) && series.requested_by !== request.authenticatedUser!.id) { await client.query("ROLLBACK"); return reply.code(403).send({ error: "You can only manage extra dates in your own booking series." }); }
      const date = await client.query(
        `SELECT dates.occurrence_date,booking.id AS booking_id,booking.status
           FROM resource_booking_series_dates dates
           JOIN resource_booking_series series_row ON series_row.id=dates.series_id AND series_row.department_id=$2
           LEFT JOIN resource_booking_series_occurrences occurrence ON occurrence.series_id=dates.series_id AND occurrence.department_id=$2
             AND occurrence.is_extra_date AND (occurrence.occurrence_starts_at AT TIME ZONE COALESCE(series_row.time_zone,'UTC'))::date=dates.occurrence_date
           LEFT JOIN resource_bookings booking ON booking.id=occurrence.resource_booking_id AND booking.department_id=$2
          WHERE dates.series_id=$1 AND dates.occurrence_date=$3 AND dates.date_type='extra' FOR UPDATE OF dates`,
        [series.id, departmentId, request.params.date],
      );
      if (!date.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Extra booking date not found." }); }
      const exclusions = await client.query("SELECT occurrence_date::text AS date FROM resource_booking_series_dates WHERE series_id=$1 AND date_type='excluded'", [series.id]);
      const regularDate = seriesDates(new Date(series.starts_at), new Date(series.ends_at), series.recurrence, [], exclusions.rows.map((row: { date: string }) => row.date), series.time_zone ?? null)
        .some((occurrence) => occurrence.localDate === request.params.date);
      if (date.rows[0].status === "approved" && !regularDate) { await client.query("ROLLBACK"); return reply.code(409).send({ error: "Cancel the approved booking individually before removing its extra date." }); }
      if (date.rows[0].booking_id && date.rows[0].status === "requested" && !regularDate) await client.query("UPDATE resource_bookings SET status='cancelled',updated_at=now() WHERE id=$1 AND department_id=$2", [date.rows[0].booking_id, departmentId]);
      await client.query("DELETE FROM resource_booking_series_dates WHERE series_id=$1 AND occurrence_date=$2 AND date_type='extra'", [series.id, date.rows[0].occurrence_date]);
      if (date.rows[0].booking_id) await client.query("UPDATE resource_booking_series_occurrences SET is_extra_date=false WHERE series_id=$1 AND resource_booking_id=$2 AND department_id=$3", [series.id, date.rows[0].booking_id, departmentId]);
      await client.query("INSERT INTO resource_scheduler_audit(id,department_id,actor_user_id,action,series_id,booking_id,details) VALUES($1,$2,$3,'extra_date_removed',$4,$5,$6::jsonb)", [randomUUID(), departmentId, request.authenticatedUser!.id, series.id, date.rows[0].booking_id, JSON.stringify({ date: request.params.date })]);
      await client.query("COMMIT");
      context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
      return { removed: true };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.post<{ Params: { seriesId: string }; Body: { date: string } }>("/api/modules/resource-scheduler/series/:seriesId/exceptions", {
    schema: { params: { type: "object", required: ["seriesId"], properties: { seriesId: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["date"], properties: { date: { type: "string", format: "date" } } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    if (!isoDate(request.body.date)) return reply.code(400).send({ error: "Choose a valid date." });
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      const series = await client.query("SELECT id,requested_by,resource_id,time_zone FROM resource_booking_series WHERE id=$1 AND department_id=$2 AND archived_at IS NULL FOR UPDATE", [request.params.seriesId, departmentId]);
      if (!series.rowCount) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Booking series not found." }); }
      if (!isManager(request) && series.rows[0].requested_by !== request.authenticatedUser!.id) { await client.query("ROLLBACK"); return reply.code(403).send({ error: "You can only edit your own booking series." }); }
      await client.query("INSERT INTO resource_booking_series_dates(series_id,occurrence_date,date_type,created_by) VALUES($1,$2,'excluded',$3) ON CONFLICT DO NOTHING", [series.rows[0].id, request.body.date, request.authenticatedUser!.id]);
      const cancelled = await client.query(`UPDATE resource_bookings booking SET status='cancelled',updated_at=now()
        FROM resource_booking_series_occurrences occurrence JOIN resource_booking_series parent ON parent.id=occurrence.series_id AND parent.department_id=occurrence.department_id
        WHERE occurrence.series_id=$1 AND occurrence.resource_booking_id=booking.id AND occurrence.department_id=$2
          AND (occurrence.occurrence_starts_at AT TIME ZONE COALESCE(parent.time_zone,'UTC'))::date=$3::date AND booking.status IN ('requested','approved') RETURNING booking.id`, [series.rows[0].id, departmentId, request.body.date]);
      await client.query("INSERT INTO resource_scheduler_audit(id,department_id,actor_user_id,action,series_id,details) VALUES($1,$2,$3,'date_excluded',$4,$5::jsonb)", [randomUUID(), departmentId, request.authenticatedUser!.id, series.rows[0].id, JSON.stringify({ date: request.body.date, cancelledBookings: cancelled.rowCount })]);
      await client.query("COMMIT");
      context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
      return { excluded: true, cancelledBookings: cancelled.rowCount };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.put<{ Params: { bookingId: string }; Body: { status: "approved" | "declined" | "cancelled"; expectedStatus?: "requested" } }>("/api/modules/resource-scheduler/bookings/:bookingId/status", {
    schema: { params: { type: "object", required: ["bookingId"], properties: { bookingId: { type: "string", format: "uuid" } } }, body: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", enum: ["approved", "declined", "cancelled"] }, expectedStatus: { type: "string", enum: ["requested"] } } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    const existing = await context.pool!.query("SELECT requested_by,status FROM resource_bookings WHERE id=$1 AND department_id=$2", [request.params.bookingId, departmentId]);
    const booking = existing.rows[0];
    if (!booking) return reply.code(404).send({ error: "Booking not found." });
    if (!isManager(request) && (request.body.status !== "cancelled" || booking.requested_by !== request.authenticatedUser!.id)) return reply.code(403).send({ error: "Resource management access is required to change booking status." });
    if (request.body.status === "approved" && !isManager(request)) return reply.code(403).send({ error: "Resource management access is required to approve bookings." });
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`WITH changed AS (
        UPDATE resource_bookings SET status=$1,updated_at=now()
        WHERE id=$2 AND department_id=$3 AND status IN ('requested','approved') AND status<>$1 AND ($7::text IS NULL OR (status=$7 AND ends_at>now()))
        RETURNING id,department_id,status
      )
      INSERT INTO resource_scheduler_audit (id,department_id,actor_user_id,action,booking_id,details)
      SELECT $4,department_id,$5,$6,id,jsonb_build_object('status',status) FROM changed`,
      [request.body.status, request.params.bookingId, departmentId, randomUUID(), request.authenticatedUser!.id, `booking_${request.body.status}`, request.body.expectedStatus ?? null]);
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: request.body.expectedStatus ? "This booking is no longer awaiting a decision." : "This booking is already closed or has that status." });
      }
      await recordResourceBookingDecision(client, departmentId, request.params.bookingId, request.authenticatedUser!.id, request.body.status);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && error.code === "23P01") return reply.code(409).send({ error: "This approval conflicts with another booking or exceeds the configured quantity." });
      throw error;
    } finally { client.release(); }
    context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
    return { status: request.body.status };
  });

  app.post<{ Params: { seriesId: string } }>("/api/modules/resource-scheduler/series/:seriesId/archive", {
    schema: { params: { type: "object", required: ["seriesId"], properties: { seriesId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    if (!context.validateMutation(request, reply)) return reply;
    const client = await context.pool!.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT id,requested_by FROM resource_booking_series WHERE id=$1 AND department_id=$2 AND archived_at IS NULL FOR UPDATE", [request.params.seriesId, departmentId]);
      const series = result.rows[0];
      if (!series) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "Booking series not found." }); }
      if (!isManager(request) && series.requested_by !== request.authenticatedUser!.id) { await client.query("ROLLBACK"); return reply.code(403).send({ error: "You can only cancel your own booking series." }); }
      await client.query("UPDATE resource_booking_series SET archived_at=now(),updated_at=now() WHERE id=$1 AND department_id=$2", [series.id, departmentId]);
      const cancelled = await client.query(`UPDATE resource_bookings booking SET status='cancelled',updated_at=now()
        FROM resource_booking_series_occurrences occurrence WHERE occurrence.series_id=$1 AND occurrence.resource_booking_id=booking.id
          AND occurrence.department_id=$2 AND booking.status IN ('requested','approved') RETURNING booking.id`, [series.id, departmentId]);
      await client.query("INSERT INTO resource_scheduler_audit(id,department_id,actor_user_id,action,series_id,details) VALUES($1,$2,$3,'series_archived',$4,$5::jsonb)", [randomUUID(), departmentId, request.authenticatedUser!.id, series.id, JSON.stringify({ cancelledBookings: cancelled.rowCount })]);
      await client.query("COMMIT");
      context.realtime.publish("module:resource-scheduler:changed", departmentId, {});
      return { archived: true, cancelledBookings: cancelled.rowCount };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.get<{ Params: { bookingId: string } }>("/api/modules/resource-scheduler/bookings/:bookingId/audit", {
    schema: { params: { type: "object", required: ["bookingId"], properties: { bookingId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    const bookingId = request.params.bookingId;
    const owner = await context.pool!.query("SELECT requested_by FROM resource_bookings WHERE id=$1 AND department_id=$2", [bookingId, departmentId]);
    if (!owner.rowCount) return reply.code(404).send({ error: "Booking not found." });
    if (!isManager(request) && owner.rows[0].requested_by !== request.authenticatedUser!.id) {
      return reply.code(403).send({ error: "You can only view the history of your own bookings." });
    }
    const result = await context.pool!.query(`SELECT audit.id,audit.action,audit.details,audit.created_at AS "createdAt",actor.display_name AS "actorName"
      FROM resource_scheduler_audit audit LEFT JOIN app_users actor ON actor.id=audit.actor_user_id
      WHERE audit.department_id=$1 AND audit.booking_id=$2
      ORDER BY audit.created_at DESC,audit.id DESC LIMIT 200`, [departmentId, bookingId]);
    return reply.header("Cache-Control", "private, no-store").send(result.rows);
  });

  app.get<{ Params: { seriesId: string } }>("/api/modules/resource-scheduler/series/:seriesId/audit", {
    schema: { params: { type: "object", required: ["seriesId"], properties: { seriesId: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    const departmentId = await location(request, reply);
    if (!departmentId) return reply;
    const owner = await context.pool!.query("SELECT requested_by FROM resource_booking_series WHERE id=$1 AND department_id=$2", [request.params.seriesId, departmentId]);
    if (!owner.rowCount) return reply.code(404).send({ error: "Booking series not found." });
    if (!isManager(request) && owner.rows[0].requested_by !== request.authenticatedUser!.id) return reply.code(403).send({ error: "You can only view the history of your own booking series." });
    const result = await context.pool!.query(`SELECT audit.id,audit.action,audit.details,audit.created_at AS "createdAt",actor.display_name AS "actorName"
      FROM resource_scheduler_audit audit LEFT JOIN app_users actor ON actor.id=audit.actor_user_id WHERE audit.department_id=$1 AND audit.series_id=$2 ORDER BY audit.created_at DESC LIMIT 500`, [departmentId, request.params.seriesId]);
    return reply.header("Cache-Control", "private, no-store").send(result.rows);
  });
}
