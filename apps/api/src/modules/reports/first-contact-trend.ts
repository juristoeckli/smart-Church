export const firstContactTrendSql = `
  WITH visible_field AS (
    SELECT id,department_id FROM people_record_fields
    WHERE department_id=$1 AND field_key='first_contact_date' AND field_type='date' AND active
      AND ($4::boolean OR visibility='private_people')
  ), contact_days AS (
    SELECT CASE WHEN jsonb_typeof(saved.value)='string' AND (saved.value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                      AND pg_input_is_valid(saved.value #>> '{}','date')
                THEN (saved.value #>> '{}')::date END AS contact_day
    FROM visible_field field
    JOIN people_record_values saved ON saved.department_id=field.department_id AND saved.field_id=field.id
    JOIN contacts person ON person.department_id=field.department_id AND person.id=saved.contact_id AND person.archived_at IS NULL
  ), totals AS (
    SELECT date_trunc('month',contact_day)::date AS month,count(*)::int AS count
    FROM contact_days WHERE contact_day BETWEEN $2::date AND $3::date GROUP BY 1
  ), months AS (
    SELECT stamp::date AS month
    FROM generate_series(date_trunc('month',$2::date::timestamp),date_trunc('month',$3::date::timestamp),'1 month') stamp
  )
  SELECT to_char(months.month,'YYYY-MM') AS month,COALESCE(totals.count,0) AS "firstContacts"
  FROM months LEFT JOIN totals ON totals.month=months.month
  WHERE EXISTS (SELECT 1 FROM visible_field) ORDER BY months.month
`;
