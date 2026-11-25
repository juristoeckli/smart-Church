import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { ReplicationExportContext } from "./modules/module-sdk.js";

type Row = Record<string, unknown>;
const invalidLink = "A Calendar or Scheduler booking link points outside this location or is missing its parent record.";
const missingPair = "Linked Calendar bookings require both Church Calendar and Resource Scheduler snapshots.";

function rows(input: unknown, name: string): Row[] {
  if (input === undefined) return [];
  const list = (input as Row | null)?.[name];
  if (!Array.isArray(list) || list.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("The signed Calendar and Scheduler link records are invalid.");
  }
  return list;
}

function evidence(links: Row[], series: Row[]) {
  const entries = [
    ...links.map((link) => ["booking", link.appointment_id, link.resource_booking_id, link.occurrence_start]),
    ...series.filter((row) => row.linked_appointment_id !== null).map((row) => ["series", row.id, row.linked_appointment_id]),
  ].map((entry) => JSON.stringify(entry)).sort();
  return entries.length ? createHash("sha256").update(JSON.stringify(entries)).digest("hex") : undefined;
}

export async function collectCalendarBookingEvidence(client: Pick<PoolClient, "query">, departmentId: string) {
  const installed = (await client.query<{ appointments: boolean; links: boolean; series: boolean }>(`SELECT
    to_regclass('public.church_calendar_appointments') IS NOT NULL AS appointments,
    to_regclass('public.church_calendar_resource_links') IS NOT NULL AS links,
    to_regclass('public.resource_booking_series') IS NOT NULL AS series`)).rows[0];
  if (installed.links && !installed.appointments) throw new Error(invalidLink);
  const links = installed.links ? (await client.query(`SELECT link.appointment_id,link.resource_booking_id,
    to_char(link.occurrence_start,'YYYY-MM-DD HH24:MI:SS.US') AS occurrence_start,
    appointment.department_id AS appointment_location, booking.department_id AS booking_location
    FROM church_calendar_resource_links link
    LEFT JOIN church_calendar_appointments appointment ON appointment.id=link.appointment_id
    LEFT JOIN resource_bookings booking ON booking.id=link.resource_booking_id
    WHERE appointment.department_id=$1 OR booking.department_id=$1`, [departmentId])).rows : [];
  const series = installed.series ? (await client.query(`SELECT series.id,series.linked_appointment_id,series.department_id AS series_location,
    ${installed.appointments ? "appointment.department_id" : "NULL::uuid"} AS appointment_location
    FROM resource_booking_series series
    ${installed.appointments ? "LEFT JOIN church_calendar_appointments appointment ON appointment.id=series.linked_appointment_id" : ""}
    WHERE series.linked_appointment_id IS NOT NULL
      AND (series.department_id=$1${installed.appointments ? " OR appointment.department_id=$1" : ""})`, [departmentId])).rows : [];
  if (links.some((row) => row.appointment_location !== departmentId || row.booking_location !== departmentId) ||
      series.some((row) => row.series_location !== departmentId || row.appointment_location !== departmentId)) throw new Error(invalidLink);
  return evidence(links, series);
}

export function requireCalendarBookingModules(value: string | undefined, manifest?: ReplicationExportContext) {
  if (value && (!manifest?.moduleIds.has("church-calendar") || !manifest.moduleIds.has("resource-scheduler"))) throw new Error(missingPair);
}

export function validateCalendarBookingSnapshots(calendar: unknown, scheduler: unknown, core: unknown) {
  const links = rows(calendar, "bookingLinks");
  const series = rows(scheduler, "series");
  const value = evidence(links, series);
  const calendarEvidence = (calendar as Row | undefined)?.calendarBookingEvidence;
  const schedulerEvidence = (scheduler as Row | undefined)?.calendarBookingEvidence;
  if ((value || calendarEvidence || schedulerEvidence) && (calendar === undefined || scheduler === undefined)) throw new Error(missingPair);
  if (calendarEvidence !== value || schedulerEvidence !== value) throw new Error("The signed Calendar and Scheduler booking links do not match.");
  if (!value) return;
  const appointments = new Set(rows(calendar, "appointments").map((row) => row.id));
  const bookings = new Set(rows((core as Row | undefined)?.tables, "resource_bookings").map((row) => row.id));
  const linkKeys = new Set<string>();
  for (const link of links) {
    const key = JSON.stringify([link.appointment_id, link.resource_booking_id]);
    if (linkKeys.has(key) || !appointments.has(link.appointment_id) || !bookings.has(link.resource_booking_id) ||
        (link.occurrence_start !== null && (typeof link.occurrence_start !== "string" ||
          !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(link.occurrence_start)))) throw new Error(invalidLink);
    linkKeys.add(key);
  }
  if (series.some((row) => row.linked_appointment_id !== null && !appointments.has(row.linked_appointment_id))) throw new Error(invalidLink);
}
