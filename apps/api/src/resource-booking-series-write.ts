import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

type Frequency = "once" | "daily" | "weekly" | "monthly" | "yearly";
export type RepeatRule = { frequency: Frequency; interval?: number; endsOn?: string; count?: number; weekdays?: number[]; anchorDate?: string; windowEnd?: string };
export type ResourceSelection = { resourceId: string; quantity: number; leadInMinutes: number; cleanupMinutes: number };

export const resourceSelectionListSchema = {
  type: "array", minItems: 1, maxItems: 20, items: {
    type: "object", additionalProperties: false, required: ["resourceId", "quantity", "leadInMinutes", "cleanupMinutes"],
    properties: {
      resourceId: { type: "string", format: "uuid" },
      quantity: { type: "integer", minimum: 1, maximum: 10000 },
      leadInMinutes: { type: "integer", minimum: 0, maximum: 10080 },
      cleanupMinutes: { type: "integer", minimum: 0, maximum: 10080 },
    },
  },
} as const;

export async function insertBookingSeries(client: PoolClient, options: ResourceSelection & {
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
