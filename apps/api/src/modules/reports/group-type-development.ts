import { activeMembershipDelta } from "./group-growth.js";

export const historicalGroupTypeOptionsSql = `
  SELECT min(btrim(history.after_data->>'group_type')) AS label
  FROM group_hierarchy_history history
  JOIN church_groups grp ON grp.department_id=history.department_id AND grp.id=history.group_id
  WHERE history.department_id=$1 AND history.entity_kind='group' AND history.entity_id=grp.id
    AND jsonb_typeof(history.after_data->'group_type')='string'
    AND char_length(btrim(history.after_data->>'group_type')) BETWEEN 1 AND 80
  GROUP BY lower(btrim(history.after_data->>'group_type'))
  ORDER BY lower(min(btrim(history.after_data->>'group_type'))) LIMIT 2000
`;

export const groupTypeDevelopmentSql = `
  WITH transitions AS (
    SELECT history.group_id,history.entity_id,history.created_at,
      date_trunc($4::text,history.created_at AT TIME ZONE $5::text)::date AS period_start,${activeMembershipDelta} AS delta
    FROM group_hierarchy_history history
    JOIN church_groups grp ON grp.department_id=history.department_id AND grp.id=history.group_id
    WHERE history.department_id=$1 AND history.entity_kind='membership'
      AND history.created_at>=($2::date::timestamp AT TIME ZONE $5::text)
      AND history.created_at<(($3::date+1)::timestamp AT TIME ZONE $5::text)
  ), attributed AS (
    SELECT transitions.*,historical.group_type,
      CASE WHEN historical.group_type IS NULL THEN 'unknown'
           WHEN historical.group_type='' THEN 'untyped' ELSE 'name:'||lower(historical.group_type) END AS type_key
    FROM transitions
    LEFT JOIN LATERAL (
      SELECT min(candidate) AS group_type
      FROM (
        SELECT CASE WHEN history.action<>'deleted' AND jsonb_typeof(history.after_data->'group_type')='string'
          AND (history.created_at<transitions.created_at OR history.action='created'
            OR lower(btrim(history.before_data->>'group_type'))=lower(btrim(history.after_data->>'group_type')))
          THEN btrim(history.after_data->>'group_type') END AS candidate
        FROM group_hierarchy_history history
        WHERE history.department_id=$1 AND history.group_id=transitions.group_id AND history.entity_kind='group'
          AND history.entity_id=transitions.group_id AND history.created_at<=transitions.created_at
        ORDER BY history.created_at DESC FETCH FIRST 1 ROW WITH TIES
      ) evidence
      HAVING count(candidate)=count(*) AND count(DISTINCT lower(candidate))=1
    ) historical ON true
    WHERE transitions.delta<>0
  ), changes AS (
    SELECT group_id,entity_id,period_start,type_key,min(group_type) AS group_type,sum(delta) AS net
    FROM attributed WHERE ($6::text IS NULL OR type_key=lower($6))
    GROUP BY group_id,entity_id,period_start,type_key
  )
  SELECT to_char(period_start,'YYYY-MM-DD') AS "periodStart",
    CASE type_key WHEN 'unknown' THEN 'Unknown' WHEN 'untyped' THEN 'No type assigned' ELSE min(group_type) END AS "groupType",
    CASE WHEN type_key IN ('unknown','untyped') THEN type_key ELSE 'recorded' END AS "typeStatus",
    count(*) FILTER (WHERE net>0)::int AS gains,count(*) FILTER (WHERE net<0)::int AS losses,
    (count(*) FILTER (WHERE net>0)-count(*) FILTER (WHERE net<0))::int AS net
  FROM changes WHERE net<>0
  GROUP BY period_start,type_key ORDER BY period_start DESC,type_key LIMIT 5001
`;
