import type { PoolClient } from "pg";
import { calendarOccurrenceExists, cleanLocalDateTime, localDateTime, wallDate, type Recurrence } from "../../calendar-occurrences.js";
import type { reviewChurchToolsCalendarSeries } from "./calendar-series.js";

type SeriesReview = ReturnType<typeof reviewChurchToolsCalendarSeries>;
type Db = Pick<PoolClient, "query">;
type LinkStatus = "ready" | "already_linked" | "service_event_unverified" | "service_event_unavailable"
  | "service_event_date_differs" | "calendar_occurrence_changed" | "calendar_link_conflict";
type LocalOccurrence = { startsAt: string; endsAt: string; cancelled: boolean; overrides: Record<string, unknown> };
type LocalSeries = { starts_at: string; ends_at: string; recurrence: Recurrence | null; linkedEventId: string | null; allDay: boolean; timeZone: string | null };
type PlanEntry = { sourceEventId: string; originalStart: string; status: LinkStatus; eventId: string | null };

export async function reviewCalendarServiceEventLinks(db: Db, departmentId: string, instanceUrl: string, review: SeriesReview,
  appointmentId: string | null, targetCalendarId: string, lock = false,
): Promise<PlanEntry[]> {
  const wanted = review.dates.flatMap((date) => date.eventId ? [{ ...date, sourceEventId: date.eventId }] : []);
  if (!wanted.length) return [];
  const sources = await db.query<{ sourceEventId: string; eventId: string; date: string; active: boolean }>(`
    SELECT provenance.source_event_id AS "sourceEventId",event.id AS "eventId",event.event_date::text AS date,
      (event.cancelled_at IS NULL AND event.kind='service') AS active
    FROM churchtools_service_event_provenance provenance JOIN service_events event
      ON event.department_id=provenance.department_id AND event.id=provenance.event_id
    WHERE provenance.department_id=$1 AND provenance.instance_url=$2 AND provenance.source_event_id=ANY($3::text[])
      AND provenance.source_appointment_id=$4
    ${lock ? "FOR SHARE OF provenance,event" : ""}`,
  [departmentId, instanceUrl, [...new Set(wanted.map(({ sourceEventId }) => sourceEventId))], review.seriesId]);
  const events = new Map(sources.rows.map((event) => [event.sourceEventId, event]));
  let local: LocalSeries | undefined;
  const extras = new Map<string, string>();
  const exceptions = new Map<string, Pick<LocalOccurrence, "cancelled" | "overrides">>();
  if (appointmentId) {
    const { rows } = await db.query<LocalSeries>(`SELECT to_char(starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
      to_char(ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at,recurrence,linked_event_id AS "linkedEventId",all_day AS "allDay",time_zone AS "timeZone"
      FROM church_calendar_appointments WHERE department_id=$1 AND id=$2 AND calendar_id=$3 AND archived_at IS NULL ${lock ? "FOR UPDATE" : ""}`,
    [departmentId, appointmentId, targetCalendarId]);
    local = rows[0];
    const starts = wanted.map(({ startsAt }) => startsAt);
    const [localExtras, localExceptions] = await Promise.all([
      db.query<Pick<LocalOccurrence, "startsAt" | "endsAt">>(`SELECT to_char(starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "startsAt",
        to_char(ends_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "endsAt" FROM church_calendar_extra_dates
        WHERE appointment_id=$1 AND starts_at=ANY($2::timestamp[]) ${lock ? "FOR UPDATE" : ""}`, [appointmentId, starts]),
      db.query<Omit<LocalOccurrence, "endsAt">>(`SELECT to_char(original_start,'YYYY-MM-DD"T"HH24:MI:SS') AS "startsAt",cancelled,overrides
        FROM church_calendar_appointment_exceptions WHERE appointment_id=$1 AND original_start=ANY($2::timestamp[]) ${lock ? "FOR UPDATE" : ""}`,
      [appointmentId, starts]),
    ]);
    for (const { startsAt, endsAt } of localExtras.rows) extras.set(startsAt, endsAt);
    for (const entry of localExceptions.rows) exceptions.set(entry.startsAt, entry);
  }

  return wanted.map(({ sourceEventId, date, startsAt, endsAt }) => {
    const event = events.get(sourceEventId);
    const entry = { sourceEventId, originalStart: startsAt, eventId: null };
    if (!event) return { ...entry, status: "service_event_unverified" };
    if (!event.active) return { ...entry, status: "service_event_unavailable" };
    if (event.date !== date) return { ...entry, status: "service_event_date_differs" };
    if (appointmentId) {
      const extraEnd = extras.get(startsAt);
      const exception = exceptions.get(startsAt);
      const overrides = exception?.overrides ?? {};
      const standard = local && calendarOccurrenceExists(local, startsAt);
      const end = extraEnd ?? (local && standard
        ? localDateTime(new Date(wallDate(startsAt).getTime() + wallDate(local.ends_at).getTime() - wallDate(local.starts_at).getTime())) : null);
      if (!local || (!standard && !extraEnd) || exception?.cancelled || (cleanLocalDateTime(overrides.startsAt) ?? startsAt) !== startsAt
        || (cleanLocalDateTime(overrides.endsAt) ?? end) !== endsAt || (overrides.allDay ?? local.allDay) !== review.allDay
        || (!review.allDay && local.timeZone !== review.zone)) return { ...entry, status: "calendar_occurrence_changed" };
      if (Object.hasOwn(overrides, "linkedEventId") || local.linkedEventId) {
        const linked = Object.hasOwn(overrides, "linkedEventId") ? overrides.linkedEventId : local.linkedEventId;
        return linked === event.eventId ? { ...entry, status: "already_linked", eventId: event.eventId }
          : { ...entry, status: "calendar_link_conflict" };
      }
    }
    return { ...entry, status: "ready", eventId: event.eventId };
  });
}

export async function applyCalendarServiceEventLinks(db: Db, appointmentId: string, actor: string, entries: PlanEntry[]) {
  const pending = entries.filter(({ status }) => status === "ready");
  if (!pending.length) return 0;
  const { rowCount } = await db.query(`INSERT INTO church_calendar_appointment_exceptions
    (appointment_id,original_start,overrides,updated_by)
    SELECT $1,link."originalStart",jsonb_build_object('linkedEventId',link."eventId"),$2
      FROM jsonb_to_recordset($3::jsonb) AS link("originalStart" timestamp,"eventId" uuid)
    ON CONFLICT (appointment_id,original_start) DO UPDATE SET
      overrides=church_calendar_appointment_exceptions.overrides || EXCLUDED.overrides,updated_at=now(),updated_by=$2
    WHERE NOT church_calendar_appointment_exceptions.cancelled
      AND NOT (church_calendar_appointment_exceptions.overrides ? 'linkedEventId')`, [appointmentId, actor, JSON.stringify(pending)]);
  if (rowCount !== pending.length) throw new Error("A calendar occurrence changed during linking.");
  return pending.length;
}

export function calendarServiceEventLinkFingerprint(entries: PlanEntry[]) {
  return entries.map(({ sourceEventId, originalStart, status, eventId }) =>
    [sourceEventId, originalStart, eventId ?? status]);
}
