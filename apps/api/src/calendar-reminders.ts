import type { Pool, PoolClient } from "pg";
import { calendarOccurrenceExists, cleanLocalDateTime, type Recurrence } from "./calendar-occurrences.js";
import { canonicalTimeZone, resolveAppointmentWallTime } from "./calendar-time.js";

export async function calendarReminderOccurrence(client: Pick<PoolClient, "query">, departmentId: string, userId: string, appointmentId: string, original: string) {
  const result = await client.query<{
    title: string; starts_at: string; recurrence: Recurrence | null; all_day: boolean;
    time_zone: string | null; location_zone: string; extra: boolean; cancelled: boolean | null; overrides: Record<string, unknown> | null;
  }>(
    `SELECT appointment.title,to_char(appointment.starts_at,'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,appointment.recurrence,appointment.all_day,
            appointment.time_zone,department.time_zone AS location_zone,extra.appointment_id IS NOT NULL AS extra,exception.cancelled,exception.overrides
       FROM church_calendar_appointments appointment
       JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id AND calendar.department_id=appointment.department_id
       JOIN departments department ON department.id=appointment.department_id
       JOIN department_memberships membership ON membership.department_id=department.id AND membership.user_id=$2
       LEFT JOIN church_calendar_extra_dates extra ON extra.appointment_id=appointment.id AND extra.starts_at=$4::timestamp
       LEFT JOIN church_calendar_appointment_exceptions exception ON exception.appointment_id=appointment.id AND exception.original_start=$4::timestamp
      WHERE appointment.id=$3 AND appointment.department_id=$1 AND appointment.archived_at IS NULL AND calendar.archived_at IS NULL
        AND (calendar.scope='community' OR calendar.owner_user_id=membership.user_id OR (calendar.scope='group' AND (
          membership.role='site_admin' OR membership.permissions && ARRAY['groups_manage','events_manage']
          OR COALESCE(membership.module_permissions->'church-calendar','[]'::jsonb) @> '["manage"]'::jsonb
          OR EXISTS (SELECT 1 FROM group_members member WHERE member.group_id=calendar.group_id
                       AND member.contact_id=membership.contact_id AND member.status='active')
        )))`, [departmentId, userId, appointmentId, original],
  );
  const row = result.rows[0];
  if (!row || row.cancelled || (row.overrides?.allDay ?? row.all_day) === true || (!row.extra && !calendarOccurrenceExists(row, original))) return null;
  const start = cleanLocalDateTime(row.overrides?.startsAt) ?? original;
  const time = resolveAppointmentWallTime(start, row.time_zone ?? canonicalTimeZone(row.location_zone) ?? "UTC");
  return time ? { title: String(row.overrides?.title ?? row.title), startsAt: time.instant } : null;
}

export async function deliverCalendarReminders(pool: Pool, writableIds: string[], lockLocation: (client: PoolClient, departmentId: string) => Promise<boolean>) {
  const storage = await pool.query<{ installed: boolean }>("SELECT to_regclass('public.church_calendar_reminders') IS NOT NULL AS installed");
  if (!storage.rows[0]?.installed) return;
  const pending = await pool.query<{ id: string; department_id: string }>(
    `SELECT id,department_id FROM church_calendar_reminders
      WHERE department_id=ANY($1::uuid[]) AND delivered_at IS NULL AND next_check_at<=now()
      ORDER BY next_check_at,id LIMIT 100`, [writableIds],
  );
  for (const candidate of pending.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!await lockLocation(client, candidate.department_id)) { await client.query("ROLLBACK"); continue; }
      const selected = await client.query<{
        id: string; department_id: string; appointment_id: string; user_id: string; original: string; minutes_before: number; reminders_enabled: boolean;
      }>(
        `SELECT reminder.id,reminder.department_id,reminder.appointment_id,reminder.user_id,reminder.minutes_before,
                to_char(reminder.original_start,'YYYY-MM-DD"T"HH24:MI:SS') AS original,COALESCE(preference.event_reminders_enabled,true) AS reminders_enabled
           FROM church_calendar_reminders reminder LEFT JOIN module_notification_preferences preference
             ON preference.department_id=reminder.department_id AND preference.user_id=reminder.user_id
          WHERE reminder.id=$1 AND reminder.delivered_at IS NULL AND reminder.next_check_at<=now() FOR UPDATE OF reminder SKIP LOCKED`,
        [candidate.id],
      );
      const reminder = selected.rows[0];
      if (!reminder) { await client.query("COMMIT"); continue; }
      const occurrence = reminder.reminders_enabled
        ? await calendarReminderOccurrence(client, reminder.department_id, reminder.user_id, reminder.appointment_id, reminder.original)
        : null;
      const now = Date.now();
      if (!occurrence || occurrence.startsAt <= now) {
        await client.query("DELETE FROM church_calendar_reminders WHERE id=$1", [reminder.id]);
      } else {
        const due = occurrence.startsAt - reminder.minutes_before * 60_000;
        if (due <= now) {
          await client.query(
            `INSERT INTO module_notifications(id,department_id,recipient_user_id,kind,title,body,in_app_enabled,email_enabled)
             VALUES(gen_random_uuid(),$1,$2,'event_reminder',left('Calendar reminder: ' || $3,120),
                    '“' || $3 || '” starts soon. Open Calendar for the appointment details.',true,false)`,
            [reminder.department_id, reminder.user_id, occurrence.title],
          );
          await client.query("UPDATE church_calendar_reminders SET delivered_at=now() WHERE id=$1", [reminder.id]);
        } else {
          await client.query("UPDATE church_calendar_reminders SET next_check_at=$2 WHERE id=$1", [reminder.id, new Date(due)]);
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
