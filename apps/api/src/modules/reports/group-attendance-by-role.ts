// A group meeting records a local date. Attribute a role only when it was known
// at the start of that date and no role or active-status change makes it ambiguous.
export const groupAttendanceByRoleSql = `
  WITH observed AS (
    SELECT attendance.contact_id,attendance.status,meeting.group_id,meeting.meeting_date,
      (meeting.meeting_date::timestamp AT TIME ZONE $5::text) AS starts_at,
      ((meeting.meeting_date+1)::timestamp AT TIME ZONE $5::text) AS ends_at
    FROM group_meetings meeting
    JOIN church_groups grp ON grp.department_id=meeting.department_id AND grp.id=meeting.group_id
    JOIN group_meeting_attendance attendance ON attendance.meeting_id=meeting.id
    JOIN contacts person ON person.department_id=meeting.department_id AND person.id=attendance.contact_id
    WHERE meeting.department_id=$1 AND ($2::uuid IS NULL OR meeting.group_id=$2)
      AND meeting.meeting_date BETWEEN $3::date AND $4::date
  ), attributed AS (
    SELECT observed.*,
      CASE WHEN prior.role IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM group_hierarchy_history change
        WHERE change.department_id=$1 AND change.group_id=observed.group_id AND change.entity_kind='membership'
          AND change.entity_id=observed.contact_id AND change.created_at>=observed.starts_at AND change.created_at<observed.ends_at
          AND (change.action<>'updated'
            OR lower(btrim(change.before_data->>'role')) IS DISTINCT FROM lower(prior.role)
            OR lower(btrim(change.after_data->>'role')) IS DISTINCT FROM lower(prior.role)
            OR change.before_data->>'status' IS DISTINCT FROM 'active'
            OR change.after_data->>'status' IS DISTINCT FROM 'active')
      ) THEN prior.role END AS role
    FROM observed
    LEFT JOIN LATERAL (
      SELECT min(role) AS role
      FROM (
        SELECT CASE WHEN history.action<>'deleted' AND history.after_data->>'status'='active'
                    THEN NULLIF(btrim(history.after_data->>'role'),'') END AS role
        FROM group_hierarchy_history history
        WHERE history.department_id=$1 AND history.group_id=observed.group_id AND history.entity_kind='membership'
          AND history.entity_id=observed.contact_id AND history.created_at<observed.starts_at
        ORDER BY history.created_at DESC FETCH FIRST 1 ROW WITH TIES
      ) latest
      HAVING count(role)=count(*) AND count(DISTINCT lower(role))=1
    ) prior ON true
  )
  SELECT to_char(meeting_date,'YYYY-MM') AS month,COALESCE(min(role),'Unknown') AS role,
    count(*) FILTER (WHERE status='present')::int AS present,
    count(*) FILTER (WHERE status='absent')::int AS absent,
    count(*) FILTER (WHERE status='excused')::int AS excused
  FROM attributed
  GROUP BY to_char(meeting_date,'YYYY-MM'),lower(COALESCE(role,'Unknown'))
  ORDER BY month,lower(COALESCE(min(role),'Unknown')) LIMIT 5000
`;
