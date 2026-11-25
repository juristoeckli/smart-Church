import type { PoolClient } from "pg";
import { appointmentWallTime, canonicalTimeZone } from "../../calendar-time.js";
import { calendarBookingWindow } from "../../calendar-occurrences.js";
import { canViewResource, hasResourceSchedulerCapacityGuard, lockResourceBookingPolicy, resourceManagerRequired } from "../../resource-booking-policy.js";
import { recordPendingResourceBookingRequest } from "../../resource-booking-notices.js";
import { insertBookingSeries, type ResourceSelection } from "../../resource-booking-series-write.js";
import { isServerModuleEnabled } from "../module-sdk.js";

export type CalendarCreatedBooking = { resourceId: string; bookingId: string; status: "requested" | "approved" };

export async function addResourcesToNewCalendarAppointment(client: PoolClient, options: {
  departmentId: string; calendarId: string; appointmentId: string; userId: string; canManageResources: boolean;
  startsAt: string; endsAt: string; authoredTimeZone?: string | null; allDay: boolean; privateTitle: boolean; title: string;
  selections: ResourceSelection[];
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
  const window = calendarBookingWindow(options.startsAt, options.endsAt, options.allDay, options.authoredTimeZone ?? timeZone);
  if (!window || ("shifted" in window && window.shifted && !options.allDay)) {
    return { status: 400, error: "Choose valid appointment times before booking resources." } as const;
  }
  const startsAt = new Date(window.startsAtUtc), endsAt = new Date(window.endsAtUtc);
  const now = Date.now();
  if (endsAt <= startsAt || startsAt.getTime() < now - 60_000 || startsAt.getTime() > now + 366 * 86_400_000) {
    return { status: 400, error: "Choose a start within the next twelve months and an end after the start." } as const;
  }
  const occurrenceStart = options.startsAt;
  const localDate = appointmentWallTime(startsAt.getTime(), timeZone).slice(0, 10);
  const siteDay = options.allDay ? calendarBookingWindow(localDate + "T00:00:00", localDate + "T00:00:00", true, timeZone) : null;
  const allDayDate = siteDay?.startsAtUtc === window.startsAtUtc && siteDay?.endsAtUtc === window.endsAtUtc ? localDate : undefined;
  const selections = options.selections.map((selection) => ({ ...selection, resourceId: selection.resourceId.toLowerCase() }))
    .sort((left, right) => left.resourceId.localeCompare(right.resourceId));
  if (new Set(selections.map(({ resourceId }) => resourceId)).size !== selections.length) {
    return { status: 400, error: "Select each resource once. Use quantity to request multiple units." } as const;
  }

  const bookings: CalendarCreatedBooking[] = [];
  let currentResource = "";
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
      const booking = await insertBookingSeries(client, {
        ...selection, departmentId, userId, purpose: options.privateTitle ? "Calendar booking" : options.title,
        startsAt, endsAt, timeZone, repeat: { frequency: "once" }, extraDates: [], excludedDates: [],
        instances: [{ startsAt, endsAt, localDate }], status, appointmentId, occurrenceStart, allDayDate,
      });
      if (status === "requested") await recordPendingResourceBookingRequest(client, departmentId, userId, booking.bookingIds);
      bookings.push({ resourceId: selection.resourceId, status, bookingId: booking.bookingIds[0] });
    }
    return { bookings };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "23P01" || code === "23505") {
      return { status: 409, error: currentResource + " conflicts with another reservation or exceeds available units. The appointment was not saved." } as const;
    }
    throw error;
  }
}
