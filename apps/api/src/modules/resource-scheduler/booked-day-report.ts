export const resourceBookedDayReport = `
  WITH visible_resources AS (
    SELECT resource.id,resource.name,resource.category,resource.location
    FROM bookable_resources resource
    WHERE resource.department_id=$1 AND ($2::boolean OR resource.active)
      AND can_view_bookable_resource(resource.department_id,resource.visibility_group_id,$3::uuid,$2::boolean)
      AND ($7::uuid IS NULL OR resource.id=$7::uuid)
      AND (NOT $8::boolean OR EXISTS (
        SELECT 1 FROM resource_scheduler_marks mark WHERE mark.department_id=resource.department_id
          AND mark.resource_id=resource.id AND mark.user_id=$3::uuid
      ))
  ), booking_days AS (
    SELECT booking.resource_id,days.day::date AS day,bool_or(booking.status='approved') AS confirmed
    FROM resource_bookings booking JOIN visible_resources resource ON resource.id=booking.resource_id
    CROSS JOIN LATERAL generate_series(
      greatest(($4::date)::timestamp,(booking.starts_at AT TIME ZONE $6::text)::date::timestamp),
      least(($5::date)::timestamp,((booking.ends_at - interval '1 microsecond') AT TIME ZONE $6::text)::date::timestamp),
      interval '1 day'
    ) AS days(day)
    WHERE booking.department_id=$1 AND booking.status IN ('approved','requested')
      AND booking.ends_at>($4::date::timestamp AT TIME ZONE $6::text)
      AND booking.starts_at<(($5::date+1)::timestamp AT TIME ZONE $6::text)
      AND (days.day AT TIME ZONE $6::text)<((days.day+interval '1 day') AT TIME ZONE $6::text)
    GROUP BY booking.resource_id,days.day::date
  )
  SELECT resource.id,resource.name,resource.category,resource.location,
    count(days.day) FILTER (WHERE days.confirmed)::int AS "confirmedDays",
    count(days.day) FILTER (WHERE NOT days.confirmed)::int AS "pendingOnlyDays"
  FROM visible_resources resource LEFT JOIN booking_days days ON days.resource_id=resource.id
  GROUP BY resource.id,resource.name,resource.category,resource.location
  ORDER BY lower(resource.category),lower(resource.name),resource.id
`;
