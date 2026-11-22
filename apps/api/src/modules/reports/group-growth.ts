export function validGroupGrowthRange(from: string | undefined, to: string | undefined) {
  const date = (value: string | undefined) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01" || value >= "9999-12-31") return NaN;
    const instant = Date.parse(value);
    return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value ? instant : NaN;
  };
  const elapsed = (date(to) - date(from)) / 86_400_000;
  return elapsed >= 0 && elapsed < 731;
}

export const activeMembershipDelta = `CASE
        WHEN history.action='created' AND history.before_data IS NULL AND history.after_data->>'status'='active' THEN 1
        WHEN history.action='updated' AND history.before_data->>'status' IN ('paused','waitlist') AND history.after_data->>'status'='active' THEN 1
        WHEN history.action='updated' AND history.before_data->>'status'='active' AND history.after_data->>'status' IN ('paused','waitlist') THEN -1
        WHEN history.action='deleted' AND history.before_data->>'status'='active' AND history.after_data IS NULL THEN -1
        ELSE 0
      END`;

export const groupGrowthSql = `
  WITH transitions AS (
    SELECT history.group_id,history.entity_id,
      date_trunc($5::text,history.created_at AT TIME ZONE $6::text)::date AS period_start,
      ${activeMembershipDelta} AS delta
    FROM group_hierarchy_history history
    JOIN church_groups current_group ON current_group.department_id=history.department_id AND current_group.id=history.group_id
    WHERE history.department_id=$1 AND history.entity_kind='membership' AND ($2::uuid IS NULL OR history.group_id=$2)
      AND history.created_at>=($3::date::timestamp AT TIME ZONE $6::text)
      AND history.created_at<(($4::date+1)::timestamp AT TIME ZONE $6::text)
  ), changes AS (
    SELECT group_id,entity_id,period_start,sum(delta) AS net
    FROM transitions
    WHERE delta<>0
    GROUP BY group_id,entity_id,period_start
  )
  SELECT changes.period_start::text AS "periodStart",current_group.name AS "groupName",
    COALESCE(to_jsonb(current_group)->>'group_type','') AS "groupType",
    count(*) FILTER (WHERE changes.net>0)::int AS "gains",
    count(*) FILTER (WHERE changes.net<0)::int AS "losses",
    (count(*) FILTER (WHERE changes.net>0)-count(*) FILTER (WHERE changes.net<0))::int AS "net"
  FROM changes
  JOIN church_groups current_group ON current_group.id=changes.group_id AND current_group.department_id=$1
  WHERE changes.net<>0
  GROUP BY changes.period_start,current_group.id
  ORDER BY changes.period_start DESC,lower(current_group.name),current_group.id
  LIMIT 5000
`;
