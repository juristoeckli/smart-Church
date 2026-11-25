import type { PoolClient } from "pg";
import { appointmentWallTime, canonicalTimeZone } from "../../calendar-time.js";
import { calendarBookingWindow, cleanLocalDateTime, localDateTime, occurrenceStarts, wallDate, type Recurrence } from "../../calendar-occurrences.js";
import { canViewResource, hasResourceSchedulerCapacityGuard, lockResourceBookingPolicy, resourceManagerRequired } from "../../resource-booking-policy.js";
import { recordPendingResourceBookingRequest } from "../../resource-booking-notices.js";
import { insertBookingSeries, type ResourceSelection } from "../../resource-booking-series-write.js";
import { isServerModuleEnabled } from "../module-sdk.js";

export type CalendarCreatedBooking = { resourceId: string; bookingId: string; occurrenceStart: string; status: "requested" | "approved" };

export async function addResourcesToNewCalendarAppointment(client: PoolClient, options: {
  departmentId: string; calendarId: string; appointmentId: string; userId: string; canManageResources: boolean;
  startsAt: string; endsAt: string; authoredTimeZone?: string | null; allDay: boolean; privateTitle: boolean; title: string;
  selections: ResourceSelection[]; recurrence?: Recurrence | null;
}) {
  const { departmentId, calendarId, appointmentId, userId, canManageResources } = options;
  if (!isServerModuleEnabled("resource-scheduler")) return { status: 409, error: "Resource Scheduler is unavailable at this location." } as const;
  const site = (await client.query<{ time_zone: string; available: boolean }>(
    `SELECT site.time_zone,
            ('resource-scheduler'=ANY(site.enabled_modules)
             AND to_regclass('public.resource_booking_series') IS NOT NULL
             AND to_regclass('public.resource_scheduler_settings') IS NOT NULL) AS available
       FROM departments site JOIN church_calendar_calendars calendar ON calendar.id=$2 AND calendar.department_id=site.id
      WHERE site.id=$1 AND calendar.scope<>'personal' AND calendar.archived_at IS NULL FOR SHARE OF calendar`,
    [departmentId, calendarId],
  )).rows[0];
  if (!site?.available || !await hasResourceSchedulerCapacityGuard(client)) {
    return { status: 409, error: "Resource Scheduler is unavailable at this location." } as const;
  }
  const timeZone = canonicalTimeZone(site.time_zone);
  if (!timeZone) return { status: 409, error: "Configure a valid location time zone before booking." } as const;
  const authoredZone = options.authoredTimeZone ?? timeZone;
  const now = Date.now();
  const horizon = now + 366 * 86_400_000;
  const horizonDate = appointmentWallTime(horizon, authoredZone).slice(0, 10);
  const { recurrence } = options;
  const startDate = options.startsAt.slice(0, 10);
  if (recurrence && recurrence.frequency !== "manual" && !recurrence.endsOn && !recurrence.count) {
    return { status: 400, error: "Choose a repeat end date or count to reserve resources for the whole series." } as const;
  }
  const manualDates = recurrence?.frequency === "manual" ? [...(recurrence.dates ?? [])].sort() : null;
  const invalidDay = (date: string) => !cleanLocalDateTime(date + "T00:00:00");
  if ((recurrence?.endsOn && invalidDay(recurrence.endsOn)) || manualDates?.some(invalidDay)) {
    return { status: 400, error: "Choose valid repeat dates before booking resources." } as const;
  }
  const endByHorizon = recurrence?.endsOn && recurrence.endsOn <= horizonDate ? recurrence.endsOn : undefined;
  const through = manualDates?.at(-1) ?? endByHorizon ?? horizonDate;
  const originals = recurrence ? occurrenceStarts(
    { starts_at: options.startsAt, recurrence }, startDate + "T00:00:00", through + "T23:59:59", 101,
  ).map(localDateTime) : [options.startsAt];
  if (originals.length > 100 || originals.length * options.selections.length > 500) {
    return { status: 400, error: "Reserve up to 100 dates and 500 total resource bookings per appointment save." } as const;
  }
  if (!originals.length) return { status: 400, error: "There are no occurrences to reserve. Review the repeat dates." } as const;
  if (recurrence && !manualDates && !endByHorizon && (!recurrence.count || originals.length < recurrence.count)) {
    return { status: 400, error: "The full booking series must fit within the next twelve months." } as const;
  }
  const duration = wallDate(options.endsAt).getTime() - wallDate(options.startsAt).getTime();
  const occurrences: Array<{ original: string; startsAt: Date; endsAt: Date; localDate: string; allDayDate?: string }> = [];
  for (const original of originals) {
    const end = localDateTime(new Date(wallDate(original).getTime() + duration));
    const window = calendarBookingWindow(original, end, options.allDay, authoredZone);
    if (!window || (window.shifted && !options.allDay && (!recurrence || original === options.startsAt))) {
      return { status: 400, error: "Choose valid booking times for the appointment on " + original.slice(0, 10) + "." } as const;
    }
    const startsAt = new Date(window.startsAtUtc), endsAt = new Date(window.endsAtUtc);
    if (endsAt <= startsAt || startsAt.getTime() < now - 60_000 || startsAt.getTime() > horizon) {
      return { status: 400, error: "Every booking must start within the next twelve months and end after it starts." } as const;
    }
    const localDate = appointmentWallTime(startsAt.getTime(), timeZone).slice(0, 10);
    const siteDay = options.allDay ? calendarBookingWindow(localDate + "T00:00:00", localDate + "T00:00:00", true, timeZone) : null;
    const allDayDate = siteDay?.startsAtUtc === window.startsAtUtc && siteDay.endsAtUtc === window.endsAtUtc ? localDate : undefined;
    occurrences.push({ original, startsAt, endsAt, localDate, allDayDate });
  }
  const selections = options.selections.map((selection) => ({ ...selection, resourceId: selection.resourceId.toLowerCase() }))
    .sort((left, right) => left.resourceId.localeCompare(right.resourceId));
  if (new Set(selections.map(({ resourceId }) => resourceId)).size !== selections.length) {
    return { status: 400, error: "Select each resource once. Use quantity to request multiple units." } as const;
  }

  const bookings: CalendarCreatedBooking[] = [];
  let currentResource = "";
  let currentDate = "";
  try {
    for (const selection of selections) {
      const policy = await lockResourceBookingPolicy(client, departmentId, selection.resourceId);
      if (!policy?.active || !await canViewResource(client, departmentId, policy.visibility_group_id, userId, canManageResources)) {
        return { status: 404, error: "A selected resource is no longer available at this location." } as const;
      }
      if (policy.intake_only) return { status: 400, error: "Request intake resources from Resource Scheduler." } as const;
      if (policy.manager_booking_only && !canManageResources) return { status: 403, error: resourceManagerRequired } as const;
      currentResource = policy.name;
      const status = policy.requires_approval && !canManageResources ? "requested" : "approved";
      for (const occurrence of occurrences) {
        const { original, startsAt, endsAt, localDate, allDayDate } = occurrence;
        currentDate = original.slice(0, 10);
        const booking = await insertBookingSeries(client, {
          ...selection, departmentId, userId, purpose: options.privateTitle ? "Calendar booking" : options.title,
          startsAt, endsAt, timeZone, repeat: { frequency: "once" }, extraDates: [], excludedDates: [],
          instances: [{ startsAt, endsAt, localDate }], status, appointmentId, occurrenceStart: original, allDayDate,
        });
        bookings.push({ resourceId: selection.resourceId, status, bookingId: booking.bookingIds[0], occurrenceStart: original });
      }
    }
    await recordPendingResourceBookingRequest(client, departmentId, userId,
      bookings.filter(({ status }) => status === "requested").map(({ bookingId }) => bookingId));
    return { bookings };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "23P01" || code === "23505") {
      return { status: 409, error: currentResource + " on " + currentDate + " conflicts with another reservation or exceeds available units. The appointment was not saved." } as const;
    }
    throw error;
  }
}
