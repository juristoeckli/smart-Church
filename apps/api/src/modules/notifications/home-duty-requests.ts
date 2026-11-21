import type { Pool } from "pg";

type Assignment = { eventId: string; title: string; date: string; time: string; positionIndex: number; positionName: string };
type Swap = { id: string; eventId: string; title: string; date: string; time: string; requesterName: string; fromPositionName: string; toPositionName: string };

const myUpcomingEvents = `SELECT event.*, person.id AS my_contact_id
  FROM department_memberships member
  JOIN contacts person ON person.id=member.contact_id AND person.department_id=member.department_id AND person.archived_at IS NULL
  JOIN service_events event ON event.department_id=member.department_id
 WHERE member.department_id=$1 AND member.user_id=$2 AND event.cancelled_at IS NULL
   AND event.source_system IS NULL AND event.event_date >= (now() AT TIME ZONE 'UTC')::date`;

export async function getHomeDutyRequests(pool: Pick<Pool, "query">, departmentId: string, userId: string) {
  const [assignments, swaps] = await Promise.all([
    pool.query<Assignment>(
      `SELECT event.id AS "eventId", event.title, to_char(event.event_date,'YYYY-MM-DD') AS date, to_char(event.start_time,'HH24:MI') AS time,
              (position.number - 1)::integer AS "positionIndex", position.item->>'name' AS "positionName"
         FROM (${myUpcomingEvents}) event
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(event.positions)='array' THEN event.positions ELSE '[]'::jsonb END
         ) WITH ORDINALITY position(item, number)
         LEFT JOIN event_position_responses response ON response.event_id=event.id AND response.position_index=position.number - 1
        WHERE position.item->>'contactId'=event.my_contact_id::text
          AND (response.contact_id IS NULL OR (response.contact_id=event.my_contact_id AND response.status='pending'))
        ORDER BY event.event_date,event.start_time,event.id,position.number LIMIT 21`,
      [departmentId, userId],
    ),
    pool.query<Swap>(
      `SELECT swap.id, event.id AS "eventId", event.title, to_char(event.event_date,'YYYY-MM-DD') AS date, to_char(event.start_time,'HH24:MI') AS time,
              concat_ws(' ', requester.first_name, requester.last_name) AS "requesterName",
              event.positions->swap.from_position_index->>'name' AS "fromPositionName",
              event.positions->swap.to_position_index->>'name' AS "toPositionName"
         FROM (${myUpcomingEvents}) event
         JOIN event_position_swap_requests swap ON swap.event_id=event.id AND swap.target_contact_id=event.my_contact_id
         JOIN contacts requester ON requester.id=swap.requester_contact_id AND requester.department_id=event.department_id AND requester.archived_at IS NULL
        WHERE swap.status='pending'
          AND event.positions->swap.from_position_index->>'contactId'=requester.id::text
          AND event.positions->swap.to_position_index->>'contactId'=event.my_contact_id::text
        ORDER BY event.event_date,event.start_time,event.id,swap.id LIMIT 21`,
      [departmentId, userId],
    ),
  ]);
  return { assignments: assignments.rows.slice(0, 20), swaps: swaps.rows.slice(0, 20),
    hasMore: assignments.rows.length > 20 || swaps.rows.length > 20 };
}
