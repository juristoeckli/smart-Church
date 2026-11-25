export const peopleMembershipGrowthSql = `
WITH range AS (
  SELECT $2::date AS start_date,
    LEAST($3::date, (CURRENT_TIMESTAMP AT TIME ZONE $4)::date) AS end_date,
    (CURRENT_TIMESTAMP AT TIME ZONE $4)::date AS today
), periods AS (
  SELECT month_start::date AS month,
    LEAST(range.end_date, (month_start + interval '1 month' - interval '1 day')::date) AS as_of,
    range.today
  FROM range CROSS JOIN LATERAL generate_series(
    date_trunc('month', range.start_date::timestamp), date_trunc('month', range.end_date::timestamp), interval '1 month'
  ) month_start
  WHERE range.start_date <= range.end_date
), cutoffs AS (
  SELECT month, as_of, as_of=today AS is_current,
    LEAST((as_of + 1)::timestamp AT TIME ZONE $4, CURRENT_TIMESTAMP) AS cutoff
  FROM periods
), profiles AS (
  SELECT period.month, contact.id,
    CASE WHEN period.is_current THEN contact.archived_at IS NOT NULL
      ELSE COALESCE(archive_before.archived, archive_after.archived, contact.archived_at < period.cutoff, false)
    END AS archived,
    CASE WHEN period.is_current THEN contact.status
      WHEN status_before.status IS NULL THEN NULL
      WHEN status_after.recorded AND status_after.status IS DISTINCT FROM status_before.status THEN NULL
      WHEN status_after.recorded IS NULL AND contact.status IS DISTINCT FROM status_before.status THEN NULL
      ELSE status_before.status
    END AS status
  FROM cutoffs period JOIN contacts contact ON contact.department_id=$1 AND contact.created_at < period.cutoff
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(DISTINCT h.after_value->>'status')=1 THEN min(h.after_value->>'status') END AS status
    FROM people_record_history h
    WHERE NOT period.is_current AND h.department_id=contact.department_id AND h.contact_id=contact.id
      AND h.action='profile_updated' AND h.subject IN ('contact_profile','bulk_status')
      AND h.after_value->>'status' IN ('member','visitor') AND h.created_at < period.cutoff
    GROUP BY h.created_at ORDER BY h.created_at DESC LIMIT 1
  ) status_before ON TRUE
  LEFT JOIN LATERAL (
    SELECT true AS recorded, CASE WHEN count(DISTINCT h.before_value->>'status')=1 THEN min(h.before_value->>'status') END AS status
    FROM people_record_history h
    WHERE NOT period.is_current AND h.department_id=contact.department_id AND h.contact_id=contact.id
      AND h.action='profile_updated' AND h.subject IN ('contact_profile','bulk_status')
      AND h.before_value->>'status' IN ('member','visitor') AND h.created_at >= period.cutoff AND h.created_at <= CURRENT_TIMESTAMP
    GROUP BY h.created_at ORDER BY h.created_at LIMIT 1
  ) status_after ON TRUE
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(DISTINCT h.action)=1 THEN bool_or(h.action='person_archived') END AS archived
    FROM people_record_history h
    WHERE NOT period.is_current AND h.department_id=contact.department_id AND h.contact_id=contact.id
      AND h.subject='archive' AND h.action IN ('person_archived','person_restored') AND h.created_at < period.cutoff
    GROUP BY h.created_at ORDER BY h.created_at DESC LIMIT 1
  ) archive_before ON TRUE
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(DISTINCT h.action)=1 THEN bool_or(h.action='person_restored') END AS archived
    FROM people_record_history h
    WHERE NOT period.is_current AND h.department_id=contact.department_id AND h.contact_id=contact.id
      AND h.subject='archive' AND h.action IN ('person_archived','person_restored')
      AND h.created_at >= period.cutoff AND h.created_at <= CURRENT_TIMESTAMP
    GROUP BY h.created_at ORDER BY h.created_at LIMIT 1
  ) archive_after ON TRUE
)
SELECT period.month::text AS "month", period.as_of::text AS "asOf",
  count(profile.id) FILTER (WHERE NOT profile.archived AND profile.status='member')::int AS members,
  count(profile.id) FILTER (WHERE NOT profile.archived AND profile.status='visitor')::int AS visitors,
  count(profile.id) FILTER (WHERE NOT profile.archived AND profile.status IS NULL)::int AS unknown,
  count(profile.id) FILTER (WHERE NOT profile.archived)::int AS "totalActive"
FROM cutoffs period LEFT JOIN profiles profile ON profile.month=period.month
GROUP BY period.month,period.as_of ORDER BY period.month
`;
