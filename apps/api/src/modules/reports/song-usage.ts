const songEntries = `SELECT event.id AS event_id, event.event_date, song.id AS song_id, song.title
  FROM service_events event
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(event.time_plan)='array' THEN event.time_plan ELSE '[]'::jsonb END) item(value)
  JOIN worship_songs song ON song.department_id=event.department_id AND song.id=CASE
    WHEN item.value->>'songId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN (item.value->>'songId')::uuid END
  WHERE event.department_id=$1 AND ($2::date IS NULL OR event.event_date >= $2::date)
    AND ($3::date IS NULL OR event.event_date <= $3::date)`;

export const overallSongUsageSql = `WITH entries AS (${songEntries})
  SELECT title AS "songTitle",count(*)::int AS uses,max(event_date)::text AS "latestUse"
  FROM entries GROUP BY song_id,title ORDER BY uses DESC,title,song_id LIMIT 2000`;

export const songCalendarTablesSql = `SELECT
  to_regclass('public.church_calendar_appointments') IS NOT NULL AND
  to_regclass('public.church_calendar_calendars') IS NOT NULL AS appointments,
  to_regclass('public.church_calendar_event_generations') IS NOT NULL AS generations`;

export function calendarSongUsageSql(appointments: boolean, generations: boolean) {
  const select = `calendar.id AS calendar_id, calendar.name AS calendar_name`;
  const community = `JOIN church_calendar_calendars calendar ON calendar.id=appointment.calendar_id
    AND calendar.department_id=appointment.department_id AND calendar.scope='community' AND calendar.archived_at IS NULL
    WHERE appointment.department_id=$1 AND appointment.archived_at IS NULL`;
  const direct = `SELECT DISTINCT appointment.linked_event_id AS event_id, ${select}
    FROM church_calendar_appointments appointment JOIN relevant_events e ON e.event_id=appointment.linked_event_id
    ${community}`;
  const generated = `SELECT generation.service_event_id AS event_id, ${select}
    FROM church_calendar_event_generations generation JOIN relevant_events e ON e.event_id=generation.service_event_id
    JOIN church_calendar_appointments appointment ON appointment.id=generation.appointment_id
      AND appointment.department_id=generation.department_id ${community}`;
  const calendarLinks = !appointments ? "SELECT NULL::uuid AS event_id, NULL::uuid AS calendar_id, NULL::text AS calendar_name WHERE false"
    : generations ? `${direct} UNION ${generated}` : direct;

  return `WITH entries AS (${songEntries}), relevant_events AS (SELECT DISTINCT event_id FROM entries),
    calendar_links AS (${calendarLinks})
    SELECT entries.title AS "songTitle",COALESCE(calendar_links.calendar_name,'No community calendar') AS "calendar",
      location.name AS campus,count(*)::int AS uses,max(entries.event_date)::text AS "latestUse"
    FROM entries JOIN departments location ON location.id=$1
    LEFT JOIN calendar_links ON calendar_links.event_id=entries.event_id
    GROUP BY entries.song_id,entries.title,calendar_links.calendar_id,calendar_links.calendar_name,location.name
    ORDER BY uses DESC,entries.title,calendar_links.calendar_name,entries.song_id,calendar_links.calendar_id LIMIT 2000`;
}
